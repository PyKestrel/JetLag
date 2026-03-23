import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.client import Client, AuthState
from app.schemas.client import ClientCreate, ClientUpdate, ClientResponse
from app.services.firewall import FirewallService
from app.services.logging_service import LoggingService
from app.services.dnsmasq import DnsmasqService
from app.services.network import NetworkService

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("", response_model=dict)
async def list_clients(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    auth_state: str | None = None,
    vlan_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Client)
    count_query = select(func.count(Client.id))

    if auth_state:
        query = query.where(Client.auth_state == auth_state)
        count_query = count_query.where(Client.auth_state == auth_state)
    if vlan_id is not None:
        query = query.where(Client.vlan_id == vlan_id)
        count_query = count_query.where(Client.vlan_id == vlan_id)

    total = (await db.execute(count_query)).scalar()
    offset = (page - 1) * per_page
    result = await db.execute(
        query.order_by(Client.last_seen.desc()).offset(offset).limit(per_page)
    )
    clients = result.scalars().all()

    return {
        "items": [ClientResponse.model_validate(c) for c in clients],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total else 0,
    }


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(client_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return ClientResponse.model_validate(client)


@router.post("/{client_id}/authenticate", response_model=ClientResponse)
async def authenticate_client(client_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    import datetime

    client.auth_state = AuthState.AUTHENTICATED
    client.authenticated_at = datetime.datetime.utcnow()
    await db.flush()

    await FirewallService.allow_client(client.ip_address, client.mac_address)
    await LoggingService.log_auth_event(
        db, client.ip_address, client.mac_address, "authenticated"
    )

    return ClientResponse.model_validate(client)


@router.post("/{client_id}/deauthenticate", response_model=ClientResponse)
async def deauthenticate_client(client_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    client.auth_state = AuthState.PENDING
    client.authenticated_at = None
    await db.flush()

    await FirewallService.intercept_client(client.ip_address, client.mac_address)
    await LoggingService.log_auth_event(
        db, client.ip_address, client.mac_address, "deauthenticated"
    )

    return ClientResponse.model_validate(client)


@router.post("/sync-leases")
async def sync_leases(db: AsyncSession = Depends(get_db)):
    """Sync clients from DHCP leases AND the ARP table.

    This discovers both DHCP clients and static-IP clients visible on the LAN.
    """
    created = 0
    updated = 0
    seen_macs: set[str] = set()

    # ── Phase 1: DHCP leases (authoritative source for hostname + MAC) ──
    leases = await DnsmasqService.get_leases()
    for lease in leases:
        mac = lease.get("mac_address")
        ip = lease.get("ip_address")
        hostname = lease.get("hostname")
        if not mac or not ip:
            continue

        mac = mac.lower()
        seen_macs.add(mac)

        result = await db.execute(select(Client).where(Client.mac_address == mac))
        client = result.scalar_one_or_none()

        if client:
            client.ip_address = ip
            if hostname:
                client.hostname = hostname
            client.last_seen = datetime.datetime.utcnow()
            updated += 1
        else:
            client = Client(
                mac_address=mac,
                ip_address=ip,
                hostname=hostname,
                auth_state=AuthState.PENDING,
                first_seen=datetime.datetime.utcnow(),
                last_seen=datetime.datetime.utcnow(),
            )
            db.add(client)
            created += 1

    # ── Phase 2: ARP table (catches static-IP clients with no DHCP lease) ──
    arp_entries = await NetworkService.get_lan_neighbours()
    for entry in arp_entries:
        mac = entry.get("mac")
        ip = entry.get("ip")
        if not mac or not ip or mac in seen_macs:
            continue

        seen_macs.add(mac)

        # Check if this MAC already exists (maybe from a portal auto-create)
        result = await db.execute(select(Client).where(Client.mac_address == mac))
        client = result.scalar_one_or_none()

        if not client:
            # Also check by IP (may have a placeholder MAC from portal auto-create)
            result = await db.execute(select(Client).where(Client.ip_address == ip))
            client = result.scalar_one_or_none()
            if client and client.mac_address.startswith("unknown-"):
                client.mac_address = mac
                client.last_seen = datetime.datetime.utcnow()
                updated += 1
                continue

        if client:
            client.ip_address = ip
            client.last_seen = datetime.datetime.utcnow()
            updated += 1
        else:
            client = Client(
                mac_address=mac,
                ip_address=ip,
                hostname=None,
                auth_state=AuthState.PENDING,
                first_seen=datetime.datetime.utcnow(),
                last_seen=datetime.datetime.utcnow(),
            )
            db.add(client)
            created += 1

    await db.flush()
    return {
        "message": f"Synced clients: {created} created, {updated} updated",
        "created": created,
        "updated": updated,
        "sources": {"dhcp_leases": len(leases), "arp_entries": len(arp_entries)},
    }


@router.post("/bulk/reset")
async def bulk_reset(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client))
    clients = result.scalars().all()

    for client in clients:
        client.auth_state = AuthState.PENDING
        client.authenticated_at = None
        if client.ip_address:
            await FirewallService.intercept_client(
                client.ip_address, client.mac_address
            )

    await db.flush()
    await LoggingService.log_system_event(db, "All client sessions reset (bulk)")

    return {"message": f"Reset {len(clients)} client(s)", "count": len(clients)}

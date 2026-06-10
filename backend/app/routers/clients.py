import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.client import Client, AuthState
from app.models.impairment_profile import ImpairmentProfile, MatchRule
from app.schemas.client import ClientCreate, ClientUpdate, ClientResponse
from app.services.firewall import FirewallService
from app.services.impairment import ImpairmentService
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
    client.session_minutes = None  # admin grant = unlimited
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
    client.session_minutes = None
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
        client.session_minutes = None
        if client.ip_address:
            await FirewallService.intercept_client(
                client.ip_address, client.mac_address
            )

    await db.flush()
    await LoggingService.log_system_event(db, "All client sessions reset (bulk)")

    return {"message": f"Reset {len(clients)} client(s)", "count": len(clients)}


# ── Per-client impairment ────────────────────────────────────────

class ClientImpairmentAttach(BaseModel):
    profile_id: int


async def _load_profile(db: AsyncSession, profile_id: int) -> ImpairmentProfile:
    result = await db.execute(
        select(ImpairmentProfile)
        .options(selectinload(ImpairmentProfile.match_rules))
        .where(ImpairmentProfile.id == profile_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.get("/{client_id}/impairment")
async def get_client_impairment(client_id: int, db: AsyncSession = Depends(get_db)):
    """List impairment profiles currently targeting this client's IP."""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not client.ip_address:
        return {"client_id": client_id, "ip_address": None, "profiles": []}

    result = await db.execute(
        select(ImpairmentProfile)
        .join(MatchRule, MatchRule.profile_id == ImpairmentProfile.id)
        .where(MatchRule.src_ip == client.ip_address)
        .distinct()
    )
    profiles = result.scalars().all()
    return {
        "client_id": client_id,
        "ip_address": client.ip_address,
        "profiles": [{"id": p.id, "name": p.name, "enabled": p.enabled} for p in profiles],
    }


@router.post("/{client_id}/impairment")
async def attach_client_impairment(
    client_id: int,
    payload: ClientImpairmentAttach,
    db: AsyncSession = Depends(get_db),
):
    """Attach an impairment profile to a specific client by adding a src_ip
    match rule, then enable and apply the profile."""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not client.ip_address:
        raise HTTPException(status_code=400, detail="Client has no known IP address")

    profile = await _load_profile(db, payload.profile_id)

    # Add a match rule for this client IP if one doesn't already exist
    existing = next(
        (r for r in profile.match_rules if r.src_ip == client.ip_address), None
    )
    if not existing:
        profile.match_rules.append(MatchRule(src_ip=client.ip_address))

    profile.enabled = True
    await db.flush()

    err = await ImpairmentService.apply_profile(profile)
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to apply impairment: {err}")

    await LoggingService.log_system_event(
        db,
        f"Applied profile '{profile.name}' to client {client.ip_address}",
    )
    return {
        "message": f"Profile '{profile.name}' applied to {client.ip_address}",
        "profile_id": profile.id,
        "client_id": client_id,
    }


@router.delete("/{client_id}/impairment/{profile_id}")
async def detach_client_impairment(
    client_id: int, profile_id: int, db: AsyncSession = Depends(get_db)
):
    """Remove this client's src_ip match rule from a profile and re-apply."""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    profile = await _load_profile(db, profile_id)

    removed = False
    for rule in list(profile.match_rules):
        if rule.src_ip == client.ip_address:
            await db.delete(rule)
            removed = True
    if not removed:
        raise HTTPException(status_code=404, detail="Client is not targeted by this profile")

    await db.flush()

    # Reload remaining rules and re-apply (or remove entirely if none remain)
    await db.refresh(profile, attribute_names=["match_rules"])
    if profile.match_rules:
        await ImpairmentService.apply_profile(profile)
    else:
        profile.enabled = False
        await db.flush()
        await ImpairmentService.remove_profile(profile)

    await LoggingService.log_system_event(
        db,
        f"Removed profile '{profile.name}' from client {client.ip_address}",
    )
    return {"message": f"Profile '{profile.name}' removed from {client.ip_address}"}

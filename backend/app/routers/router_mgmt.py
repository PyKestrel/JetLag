"""Router / ISR management API.

Provides endpoints for:
  - Routing table view + static routes
  - Custom NAT rules
  - Interface management
  - ARP / neighbor table
  - Sysctl settings
  - DHCP reservations
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.static_route import StaticRoute
from app.models.nat_rule import NatRule
from app.models.dhcp_reservation import DHCPReservation

logger = logging.getLogger("jetlag.router_mgmt")
router = APIRouter(prefix="/api/router", tags=["router"])


# ── Helpers ──────────────────────────────────────────────────────

async def _run(cmd: str) -> tuple[str, str, int]:
    proc = await asyncio.create_subprocess_shell(
        cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return out.decode().strip(), err.decode().strip(), proc.returncode


# ── Routing Table ────────────────────────────────────────────────

@router.get("/routes")
async def list_routes():
    """Return the kernel routing table."""
    out, err, rc = await _run("ip -j route show")
    if rc != 0:
        return {"routes": [], "error": err}
    import json
    try:
        return {"routes": json.loads(out)}
    except Exception:
        # Fallback to plain text
        out2, _, _ = await _run("ip route show")
        return {"routes": out2.splitlines()}


class StaticRouteCreate(BaseModel):
    destination: str
    gateway: Optional[str] = None
    interface: Optional[str] = None
    metric: int = 100
    enabled: bool = True
    comment: Optional[str] = None


class StaticRouteResponse(BaseModel):
    id: int
    destination: str
    gateway: Optional[str]
    interface: Optional[str]
    metric: int
    enabled: bool
    comment: Optional[str]
    model_config = {"from_attributes": True}


@router.get("/routes/static")
async def list_static_routes(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(StaticRoute).order_by(StaticRoute.id))).scalars().all()
    return {"items": [StaticRouteResponse.model_validate(r) for r in rows]}


@router.post("/routes/static", status_code=201)
async def add_static_route(payload: StaticRouteCreate, db: AsyncSession = Depends(get_db)):
    route = StaticRoute(**payload.model_dump())
    db.add(route)
    await db.flush()
    await db.refresh(route)
    if route.enabled:
        await _apply_static_route(route)
    return StaticRouteResponse.model_validate(route)


@router.delete("/routes/static/{route_id}")
async def remove_static_route(route_id: int, db: AsyncSession = Depends(get_db)):
    route = await db.get(StaticRoute, route_id)
    if not route:
        raise HTTPException(404, "Static route not found")
    await _remove_static_route(route)
    await db.delete(route)
    return {"message": f"Static route {route_id} deleted"}


async def _apply_static_route(route: StaticRoute):
    parts = ["ip", "route", "add", route.destination]
    if route.gateway:
        parts += ["via", route.gateway]
    if route.interface:
        parts += ["dev", route.interface]
    parts += ["metric", str(route.metric)]
    _, err, rc = await _run(" ".join(parts))
    if rc != 0:
        logger.error(f"Failed to add static route: {err}")


async def _remove_static_route(route: StaticRoute):
    parts = ["ip", "route", "del", route.destination]
    if route.gateway:
        parts += ["via", route.gateway]
    if route.interface:
        parts += ["dev", route.interface]
    _, err, rc = await _run(" ".join(parts))
    if rc != 0:
        logger.warning(f"Failed to remove static route (may not exist): {err}")


# ── NAT Rules ────────────────────────────────────────────────────

class NatRuleCreate(BaseModel):
    name: str
    type: str = "masquerade"             # snat, dnat, masquerade
    protocol: str = "any"
    src_ip: Optional[str] = None
    dst_ip: Optional[str] = None
    src_port: Optional[str] = None
    dst_port: Optional[str] = None
    to_address: Optional[str] = None
    to_port: Optional[str] = None
    interface: Optional[str] = None
    enabled: bool = True
    comment: Optional[str] = None


class NatRuleResponse(BaseModel):
    id: int
    name: str
    type: str
    protocol: str
    src_ip: Optional[str]
    dst_ip: Optional[str]
    src_port: Optional[str]
    dst_port: Optional[str]
    to_address: Optional[str]
    to_port: Optional[str]
    interface: Optional[str]
    enabled: bool
    comment: Optional[str]
    model_config = {"from_attributes": True}


@router.get("/nat")
async def list_nat_rules(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(NatRule).order_by(NatRule.id))).scalars().all()
    return {"items": [NatRuleResponse.model_validate(r) for r in rows]}


@router.post("/nat", status_code=201)
async def add_nat_rule(payload: NatRuleCreate, db: AsyncSession = Depends(get_db)):
    if payload.type not in ("snat", "dnat", "masquerade"):
        raise HTTPException(422, f"Invalid NAT type: {payload.type}")
    rule = NatRule(**payload.model_dump())
    db.add(rule)
    await db.flush()
    await db.refresh(rule)
    return NatRuleResponse.model_validate(rule)


@router.delete("/nat/{rule_id}")
async def remove_nat_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    rule = await db.get(NatRule, rule_id)
    if not rule:
        raise HTTPException(404, "NAT rule not found")
    await db.delete(rule)
    return {"message": f"NAT rule {rule_id} deleted"}


# ── Interfaces ───────────────────────────────────────────────────

@router.get("/interfaces")
async def list_interfaces():
    """List all network interfaces with details."""
    out, err, rc = await _run("ip -j addr show")
    if rc != 0:
        return {"interfaces": [], "error": err}
    import json
    try:
        return {"interfaces": json.loads(out)}
    except Exception:
        out2, _, _ = await _run("ip addr show")
        return {"interfaces": out2}


class InterfaceUpdate(BaseModel):
    ip_address: Optional[str] = None   # CIDR, e.g. 192.168.1.1/24
    state: Optional[str] = None         # up or down
    mtu: Optional[int] = None


@router.put("/interfaces/{name}")
async def update_interface(name: str, payload: InterfaceUpdate):
    """Modify an interface's IP, state, or MTU."""
    results = []
    if payload.state in ("up", "down"):
        _, err, rc = await _run(f"ip link set {name} {payload.state}")
        results.append({"action": f"set {payload.state}", "success": rc == 0, "error": err if rc else None})
    if payload.mtu:
        _, err, rc = await _run(f"ip link set {name} mtu {payload.mtu}")
        results.append({"action": f"set mtu {payload.mtu}", "success": rc == 0, "error": err if rc else None})
    if payload.ip_address:
        # Flush existing and add new
        await _run(f"ip addr flush dev {name}")
        _, err, rc = await _run(f"ip addr add {payload.ip_address} dev {name}")
        results.append({"action": f"set ip {payload.ip_address}", "success": rc == 0, "error": err if rc else None})
    return {"interface": name, "results": results}


# ── ARP / Neighbor Table ────────────────────────────────────────

@router.get("/arp")
async def list_arp():
    out, err, rc = await _run("ip -j neigh show")
    if rc != 0:
        return {"entries": [], "error": err}
    import json
    try:
        return {"entries": json.loads(out)}
    except Exception:
        out2, _, _ = await _run("ip neigh show")
        return {"entries": out2.splitlines()}


@router.delete("/arp")
async def flush_arp():
    _, err, rc = await _run("ip neigh flush all")
    if rc != 0:
        raise HTTPException(500, f"Failed to flush ARP: {err}")
    return {"message": "ARP cache flushed"}


# ── Sysctl ──────────────────────────────────────────────────────

_ALLOWED_SYSCTLS = {
    "net.ipv4.ip_forward",
    "net.ipv4.conf.all.rp_filter",
    "net.ipv4.conf.default.rp_filter",
    "net.ipv4.conf.all.accept_redirects",
    "net.ipv4.conf.all.send_redirects",
    "net.ipv4.icmp_echo_ignore_all",
    "net.ipv6.conf.all.forwarding",
    "net.ipv6.conf.all.disable_ipv6",
}


@router.get("/sysctl")
async def get_sysctls():
    result = {}
    for key in sorted(_ALLOWED_SYSCTLS):
        out, _, rc = await _run(f"sysctl -n {key}")
        result[key] = out.strip() if rc == 0 else None
    return {"sysctls": result}


class SysctlUpdate(BaseModel):
    values: dict[str, str]


@router.put("/sysctl")
async def set_sysctls(payload: SysctlUpdate):
    results = {}
    for key, val in payload.values.items():
        if key not in _ALLOWED_SYSCTLS:
            results[key] = {"success": False, "error": f"Not in allowlist"}
            continue
        _, err, rc = await _run(f"sysctl -w {key}={val}")
        results[key] = {"success": rc == 0, "error": err if rc else None}
    return {"results": results}


# ── DHCP Reservations ────────────────────────────────────────────

class DHCPReservationCreate(BaseModel):
    mac_address: str
    ip_address: str
    hostname: Optional[str] = None
    comment: Optional[str] = None


class DHCPReservationResponse(BaseModel):
    id: int
    mac_address: str
    ip_address: str
    hostname: Optional[str]
    comment: Optional[str]
    model_config = {"from_attributes": True}


@router.get("/dhcp/reservations")
async def list_dhcp_reservations(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(DHCPReservation).order_by(DHCPReservation.id))).scalars().all()
    return {"items": [DHCPReservationResponse.model_validate(r) for r in rows]}


@router.post("/dhcp/reservations", status_code=201)
async def add_dhcp_reservation(payload: DHCPReservationCreate, db: AsyncSession = Depends(get_db)):
    reservation = DHCPReservation(**payload.model_dump())
    db.add(reservation)
    await db.flush()
    await db.refresh(reservation)
    # Regenerate dnsmasq config to include the reservation
    try:
        from app.services.dnsmasq import DnsmasqService
        await DnsmasqService.generate_config()
        await DnsmasqService.restart()
    except Exception as e:
        logger.error(f"Failed to regenerate dnsmasq config: {e}")
    return DHCPReservationResponse.model_validate(reservation)


@router.delete("/dhcp/reservations/{reservation_id}")
async def remove_dhcp_reservation(reservation_id: int, db: AsyncSession = Depends(get_db)):
    reservation = await db.get(DHCPReservation, reservation_id)
    if not reservation:
        raise HTTPException(404, "DHCP reservation not found")
    await db.delete(reservation)
    # Regenerate dnsmasq config
    try:
        from app.services.dnsmasq import DnsmasqService
        await DnsmasqService.generate_config()
        await DnsmasqService.restart()
    except Exception as e:
        logger.error(f"Failed to regenerate dnsmasq config: {e}")
    return {"message": f"DHCP reservation {reservation_id} deleted"}

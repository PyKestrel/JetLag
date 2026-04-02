import datetime
from typing import Optional
from pydantic import BaseModel


class FirewallRuleCreate(BaseModel):
    name: str
    enabled: bool = True
    priority: int = 100
    direction: str = "forward"          # inbound, outbound, forward
    action: str = "drop"                # accept, drop, reject
    protocol: str = "any"               # tcp, udp, icmp, any
    src_ip: Optional[str] = None
    dst_ip: Optional[str] = None
    src_port: Optional[str] = None      # "443" or "1000-2000"
    dst_port: Optional[str] = None
    comment: Optional[str] = None


class FirewallRuleUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    direction: Optional[str] = None
    action: Optional[str] = None
    protocol: Optional[str] = None
    src_ip: Optional[str] = None
    dst_ip: Optional[str] = None
    src_port: Optional[str] = None
    dst_port: Optional[str] = None
    comment: Optional[str] = None


class FirewallRuleResponse(BaseModel):
    id: int
    name: str
    enabled: bool
    priority: int
    direction: str
    action: str
    protocol: str
    src_ip: Optional[str]
    dst_ip: Optional[str]
    src_port: Optional[str]
    dst_port: Optional[str]
    comment: Optional[str]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}

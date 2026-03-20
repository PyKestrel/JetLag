import datetime
from typing import Optional
from pydantic import BaseModel


class MatchRuleCreate(BaseModel):
    src_ip: Optional[str] = None
    dst_ip: Optional[str] = None
    src_subnet: Optional[str] = None
    dst_subnet: Optional[str] = None
    mac_address: Optional[str] = None
    vlan_id: Optional[int] = None
    protocol: Optional[str] = None
    port: Optional[int] = None


class MatchRuleResponse(MatchRuleCreate):
    id: int
    profile_id: int

    model_config = {"from_attributes": True}


class ImpairmentProfileCreate(BaseModel):
    name: str
    description: Optional[str] = None
    enabled: bool = False
    latency_ms: int = 0
    jitter_ms: int = 0
    packet_loss_percent: float = 0.0
    bandwidth_limit_kbps: int = 0
    match_rules: list[MatchRuleCreate] = []


class ImpairmentProfileUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    latency_ms: Optional[int] = None
    jitter_ms: Optional[int] = None
    packet_loss_percent: Optional[float] = None
    bandwidth_limit_kbps: Optional[int] = None
    match_rules: Optional[list[MatchRuleCreate]] = None


class ImpairmentProfileResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    enabled: bool
    latency_ms: int
    jitter_ms: int
    packet_loss_percent: float
    bandwidth_limit_kbps: int
    match_rules: list[MatchRuleResponse] = []
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}

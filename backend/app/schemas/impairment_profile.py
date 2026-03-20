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
    # Latency / Jitter
    latency_ms: int = 0
    jitter_ms: int = 0
    latency_correlation: float = 0.0
    latency_distribution: str = ""
    # Packet Loss
    packet_loss_percent: float = 0.0
    loss_correlation: float = 0.0
    # Corruption
    corruption_percent: float = 0.0
    corruption_correlation: float = 0.0
    # Reordering
    reorder_percent: float = 0.0
    reorder_correlation: float = 0.0
    # Duplication
    duplicate_percent: float = 0.0
    duplicate_correlation: float = 0.0
    # Rate Control
    bandwidth_limit_kbps: int = 0
    bandwidth_burst_kbytes: int = 0
    bandwidth_ceil_kbps: int = 0
    match_rules: list[MatchRuleCreate] = []


class ImpairmentProfileUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    latency_ms: Optional[int] = None
    jitter_ms: Optional[int] = None
    latency_correlation: Optional[float] = None
    latency_distribution: Optional[str] = None
    packet_loss_percent: Optional[float] = None
    loss_correlation: Optional[float] = None
    corruption_percent: Optional[float] = None
    corruption_correlation: Optional[float] = None
    reorder_percent: Optional[float] = None
    reorder_correlation: Optional[float] = None
    duplicate_percent: Optional[float] = None
    duplicate_correlation: Optional[float] = None
    bandwidth_limit_kbps: Optional[int] = None
    bandwidth_burst_kbytes: Optional[int] = None
    bandwidth_ceil_kbps: Optional[int] = None
    match_rules: Optional[list[MatchRuleCreate]] = None


class ImpairmentProfileResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    enabled: bool
    latency_ms: int
    jitter_ms: int
    latency_correlation: float
    latency_distribution: str
    packet_loss_percent: float
    loss_correlation: float
    corruption_percent: float
    corruption_correlation: float
    reorder_percent: float
    reorder_correlation: float
    duplicate_percent: float
    duplicate_correlation: float
    bandwidth_limit_kbps: int
    bandwidth_burst_kbytes: int
    bandwidth_ceil_kbps: int
    match_rules: list[MatchRuleResponse] = []
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}

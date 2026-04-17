from typing import Optional
from pydantic import BaseModel, Field


# ── Step schemas ────────────────────────────────────────────────

class ReplayStepBase(BaseModel):
    offset_ms: int = 0
    duration_ms: int = Field(default=1000, ge=1000)
    latency_ms: int = 0
    jitter_ms: int = 0
    packet_loss_percent: float = 0.0
    bandwidth_kbps: int = 0


class ReplayStepCreate(ReplayStepBase):
    pass


class ReplayStepResponse(ReplayStepBase):
    id: int
    scenario_id: int
    step_index: int

    class Config:
        from_attributes = True


# ── Scenario schemas ────────────────────────────────────────────

class ReplayScenarioCreate(BaseModel):
    name: str
    description: Optional[str] = None
    default_direction: str = "outbound"
    steps: list[ReplayStepCreate] = []


class ReplayScenarioUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    default_direction: Optional[str] = None
    steps: Optional[list[ReplayStepCreate]] = None


class ReplayScenarioResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    default_direction: str
    total_duration_ms: int
    step_count: int
    source_filename: Optional[str] = None
    created_at: str
    updated_at: str
    steps: list[ReplayStepResponse] = []

    class Config:
        from_attributes = True


class ReplayScenarioListItem(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    default_direction: str
    total_duration_ms: int
    step_count: int
    source_filename: Optional[str] = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ── Session schemas ─────────────────────────────────────────────

class ReplaySessionStart(BaseModel):
    profile_id: int
    scenario_id: int
    loop: bool = False
    playback_speed: float = Field(default=1.0, ge=0.1, le=10.0)
    start_offset_ms: Optional[int] = None
    end_offset_ms: Optional[int] = None


class ReplaySessionStatus(BaseModel):
    profile_id: int
    scenario_id: Optional[int] = None
    scenario_name: str = ""
    state: str = "idle"  # idle, running, paused, completed, stopped
    current_step_index: int = 0
    total_steps: int = 0
    elapsed_ms: int = 0
    total_ms: int = 0
    loop: bool = False
    loop_count: int = 0
    playback_speed: float = 1.0
    current_values: Optional[dict] = None
    has_snapshot: bool = False

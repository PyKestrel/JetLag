import datetime
from typing import Optional
from pydantic import BaseModel


class CaptureCreate(BaseModel):
    name: str
    filter_ip: Optional[str] = None
    filter_mac: Optional[str] = None
    filter_vlan: Optional[int] = None
    filter_expression: Optional[str] = None


class CaptureResponse(BaseModel):
    id: int
    name: str
    state: str
    file_path: str
    file_size_bytes: int
    filter_ip: Optional[str]
    filter_mac: Optional[str]
    filter_vlan: Optional[int]
    filter_expression: Optional[str]
    pid: Optional[int]
    started_at: datetime.datetime
    stopped_at: Optional[datetime.datetime]

    model_config = {"from_attributes": True}

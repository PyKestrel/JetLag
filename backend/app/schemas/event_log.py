import datetime
from typing import Optional
from pydantic import BaseModel


class EventLogResponse(BaseModel):
    id: int
    category: str
    level: str
    message: str
    source_ip: Optional[str]
    source_mac: Optional[str]
    details: Optional[str]
    created_at: datetime.datetime

    model_config = {"from_attributes": True}

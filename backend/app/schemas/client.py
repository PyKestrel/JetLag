import datetime
from typing import Optional
from pydantic import BaseModel


class ClientCreate(BaseModel):
    mac_address: str
    ip_address: Optional[str] = None
    hostname: Optional[str] = None
    vlan_id: Optional[int] = None


class ClientUpdate(BaseModel):
    ip_address: Optional[str] = None
    hostname: Optional[str] = None
    vlan_id: Optional[int] = None
    auth_state: Optional[str] = None


class ClientResponse(BaseModel):
    id: int
    mac_address: str
    ip_address: Optional[str]
    hostname: Optional[str]
    vlan_id: Optional[int]
    auth_state: str
    first_seen: datetime.datetime
    last_seen: datetime.datetime
    authenticated_at: Optional[datetime.datetime]

    model_config = {"from_attributes": True}

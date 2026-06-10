import datetime

from sqlalchemy import Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MetricSample(Base):
    """A persisted aggregate-throughput data point.

    Written periodically by the metrics sampler loop so the UI can render
    historical charts (beyond the short-lived in-memory ring buffer) and so
    data survives a restart. Rows older than the retention window are pruned.
    """

    __tablename__ = "metric_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, index=True
    )
    rx_bps: Mapped[int] = mapped_column(Integer, default=0)
    tx_bps: Mapped[int] = mapped_column(Integer, default=0)

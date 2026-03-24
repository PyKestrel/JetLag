import logging
import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger("jetlag.database")

DB_DIR = Path(os.environ.get("JETLAG_DB_DIR", Path(__file__).parent.parent / "data"))
DB_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite+aiosqlite:///{DB_DIR / 'jetlag.db'}"

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def _run_alembic_upgrade():
    """Run Alembic migrations synchronously (called once at startup)."""
    try:
        from alembic.config import Config
        from alembic import command

        alembic_dir = Path(__file__).parent.parent / "alembic"
        alembic_ini = Path(__file__).parent.parent / "alembic.ini"

        if not alembic_ini.exists():
            logger.warning("alembic.ini not found — falling back to create_all")
            return False

        cfg = Config(str(alembic_ini))
        cfg.set_main_option("script_location", str(alembic_dir))

        # Stamp the DB if alembic_version table doesn't exist yet (first run on
        # an existing database that was created by create_all before Alembic).
        from sqlalchemy import create_engine, inspect
        sync_url = f"sqlite:///{DB_DIR / 'jetlag.db'}"
        sync_engine = create_engine(sync_url)
        inspector = inspect(sync_engine)
        tables = inspector.get_table_names()

        if "alembic_version" not in tables and len(tables) > 0:
            # Existing DB without Alembic — stamp it at the baseline so
            # future migrations apply cleanly.
            logger.info("Existing database detected — stamping at baseline revision")
            command.stamp(cfg, "001_baseline")
        
        command.upgrade(cfg, "head")
        sync_engine.dispose()
        logger.info("Alembic migrations applied successfully")
        return True
    except Exception as e:
        logger.error(f"Alembic migration failed: {e}")
        return False


async def init_db():
    # Try Alembic first; fall back to create_all if Alembic isn't available
    if not _run_alembic_upgrade():
        logger.info("Falling back to SQLAlchemy create_all")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

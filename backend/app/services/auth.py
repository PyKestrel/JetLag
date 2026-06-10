"""Authentication service — password hashing + JWT issuance/verification."""

import datetime
import logging
import secrets
from pathlib import Path
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import DB_DIR
from app.models.user import User

logger = logging.getLogger("jetlag.auth")

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_ALGORITHM = "HS256"
_SECRET_FILE = DB_DIR / ".jwt_secret"

# Default seeded admin credentials (forces a password change on first login).
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin"


def _get_secret_key() -> str:
    """Return a persistent random secret, generating it on first use."""
    try:
        if _SECRET_FILE.exists():
            return _SECRET_FILE.read_text().strip()
        key = secrets.token_urlsafe(48)
        _SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SECRET_FILE.write_text(key)
        try:
            _SECRET_FILE.chmod(0o600)
        except OSError:
            pass
        return key
    except OSError:
        # Fall back to an ephemeral key (tokens won't survive restart).
        logger.warning("Could not persist JWT secret; using ephemeral key")
        return secrets.token_urlsafe(48)


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _pwd_context.verify(password, password_hash)
    except ValueError:
        return False


def create_access_token(username: str, role: str) -> str:
    expire = datetime.datetime.utcnow() + datetime.timedelta(
        hours=settings.admin.token_expire_hours
    )
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, _get_secret_key(), algorithm=_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """Return the token payload, or None if invalid/expired."""
    try:
        return jwt.decode(token, _get_secret_key(), algorithms=[_ALGORITHM])
    except JWTError:
        return None


async def authenticate_user(db: AsyncSession, username: str, password: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user


async def count_users(db: AsyncSession) -> int:
    return (await db.execute(select(func.count(User.id)))).scalar() or 0


async def ensure_default_admin() -> None:
    """Seed a default admin user if no users exist yet."""
    from app.database import async_session

    async with async_session() as db:
        if await count_users(db) > 0:
            return
        user = User(
            username=DEFAULT_ADMIN_USERNAME,
            password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
            role="admin",
            must_change_password=True,
        )
        db.add(user)
        await db.commit()
        logger.warning(
            "Seeded default admin user 'admin'/'admin' — change the password immediately."
        )

#!/usr/bin/env python3
"""Admin account recovery tool.

Run this on the appliance (from the ``backend`` directory, inside the same
virtualenv the server uses) to list, create, or reset admin accounts when you
are locked out of the web UI.

Examples
--------
List existing users::

    python reset_admin.py --list

Create or reset an admin (prompts for the password)::

    python reset_admin.py atorres

Non-interactive (password on the command line)::

    python reset_admin.py atorres --password 'mysecret'
"""

import argparse
import asyncio
import getpass
import sys

from sqlalchemy import select

from app.database import async_session, init_db
from app.models.user import User
from app.services.auth import hash_password, verify_password


async def _list_users() -> None:
    async with async_session() as db:
        users = (await db.execute(select(User))).scalars().all()
        if not users:
            print("No users exist yet.")
            return
        print(f"{'id':>3}  {'username':<20} {'role':<10} must_change_password")
        for u in users:
            print(f"{u.id:>3}  {u.username:<20} {u.role:<10} {u.must_change_password}")


async def _upsert_admin(username: str, password: str) -> None:
    async with async_session() as db:
        existing = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        if existing:
            existing.password_hash = hash_password(password)
            existing.must_change_password = False
            existing.role = "admin"
            action = "reset"
        else:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(password),
                    role="admin",
                    must_change_password=False,
                )
            )
            action = "created"
        await db.commit()

    # Verify round-trip so we fail loudly if hashing is misconfigured.
    async with async_session() as db:
        user = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        ok = user is not None and verify_password(password, user.password_hash)
    status = "OK" if ok else "FAILED verification!"
    print(f"Admin '{username}' {action}. Password check: {status}")
    if not ok:
        sys.exit(1)


async def _main() -> None:
    parser = argparse.ArgumentParser(description="JetLag admin recovery tool")
    parser.add_argument("username", nargs="?", help="Admin username to create/reset")
    parser.add_argument("--password", help="New password (omit to be prompted)")
    parser.add_argument("--list", action="store_true", help="List existing users and exit")
    args = parser.parse_args()

    # Ensure tables exist before touching them.
    await init_db()

    if args.list or not args.username:
        await _list_users()
        if not args.username:
            return

    password = args.password
    if not password:
        password = getpass.getpass(f"New password for '{args.username}': ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Passwords do not match.")
            sys.exit(1)
    if len(password) < 6:
        print("Password must be at least 6 characters.")
        sys.exit(1)

    await _upsert_admin(args.username, password)


if __name__ == "__main__":
    asyncio.run(_main())

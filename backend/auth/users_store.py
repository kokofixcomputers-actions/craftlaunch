"""
auth/users_store.py – persist users to/from users.json on disk.

File location: <data_dir>/users.json
Schema:
  {
    "users": [ { id, username, uuid, accessToken, refreshToken, isActive }, ... ],
    "activeUserId": "<id>"
  }

The frontend also keeps users in localStorage for fast startup, but this file
is the authoritative backend store so the launcher works even if localStorage
is cleared.
"""

import json
import os
from pathlib import Path
from typing import Optional

import paths


def _load_raw() -> dict:
    """Load the raw JSON dict from disk, or return empty structure."""
    print(f"[DEBUG] _load_raw: checking file at {paths.USERS_FILE}")
    if paths.USERS_FILE.exists():
        try:
            with open(paths.USERS_FILE, "r", encoding="utf-8") as f:
                result = json.load(f)
                print(f"[DEBUG] _load_raw: successfully loaded JSON with {len(result.get('users', []))} users")
                return result
        except Exception as e:
            print(f"[DEBUG] _load_raw: error reading file: {e}")
            pass
    else:
        print("[DEBUG] _load_raw: users.json file does not exist")
    return {"users": [], "activeUserId": None}


def _save_raw(data: dict):
    paths.USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = paths.USERS_FILE.with_suffix(".tmp")
    try:
        # Write to temporary file with explicit truncation
        with open(tmp, "w", encoding="utf-8", newline='') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())  # Force write to disk
        
        # Atomic replace - this should overwrite the existing file
        tmp.replace(paths.USERS_FILE)
    except Exception:
        # Clean up temp file if something goes wrong
        if tmp.exists():
            tmp.unlink()
        raise


def load_users() -> dict:
    """Return {"users": [...], "activeUserId": str|None}"""
    return _load_raw()


def save_users(users: list[dict], active_user_id: Optional[str]):
    """Persist the full user list and active user id."""
    _save_raw({"users": users, "activeUserId": active_user_id})


def upsert_user(user: dict):
    """Add or update a single user entry."""
    data = _load_raw()
    existing = {u["id"]: u for u in data.get("users", [])}
    existing[user["id"]] = user
    data["users"] = list(existing.values())
    if not data.get("activeUserId"):
        data["activeUserId"] = user["id"]
    _save_raw(data)


def remove_user(user_id: str):
    data = _load_raw()
    data["users"] = [u for u in data.get("users", []) if u["id"] != user_id]
    if data.get("activeUserId") == user_id:
        data["activeUserId"] = data["users"][0]["id"] if data["users"] else None
    _save_raw(data)


def set_active_user(user_id: str):
    data = _load_raw()
    data["activeUserId"] = user_id
    _save_raw(data)


def update_tokens(user_id: str, access_token: str, refresh_token: str):
    """Update just the tokens for a user (called after token refresh)."""
    data = _load_raw()
    for u in data.get("users", []):
        if u["id"] == user_id:
            u["accessToken"]  = access_token
            u["refreshToken"] = refresh_token
            break
    _save_raw(data)


def get_user(user_id: str) -> Optional[dict]:
    data = _load_raw()
    for u in data.get("users", []):
        if u["id"] == user_id:
            return u
    return None


def get_active_user() -> Optional[dict]:
    data = _load_raw()
    active_id = data.get("activeUserId")
    if not active_id:
        users = data.get("users", [])
        return users[0] if users else None
    for u in data.get("users", []):
        if u["id"] == active_id:
            return u
    return None

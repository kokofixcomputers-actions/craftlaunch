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
import time
from pathlib import Path
from typing import Optional
import threading

import paths

# Global write queue to prevent rapid-fire writes
_write_queue = []
_write_lock = threading.Lock()
_write_timer = None

# Global operation lock to serialize all user operations
_operation_lock = threading.Lock()

def _queue_write(data: dict):
    """Queue a write operation with debouncing"""
    global _write_timer, _write_queue
    
    with _write_lock:
        _write_queue.append(data)
        
        # Cancel existing timer
        if _write_timer:
            _write_timer.cancel()
        
        # Set new timer for 100ms from now (reduced from 500ms)
        _write_timer = threading.Timer(0.1, _process_write_queue)
        _write_timer.start()

def _process_write_queue():
    """Process the latest write from the queue"""
    global _write_queue
    
    with _write_lock:
        if _write_queue:
            # Get the latest data
            latest_data = _write_queue[-1]
            _write_queue.clear()
            
            # Write directly to file
            try:
                paths.USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
                with open(paths.USERS_FILE, "w", encoding="utf-8", newline='') as f:
                    json.dump(latest_data, f, indent=2, ensure_ascii=False)
                    f.flush()
                print(f"[DEBUG] Direct write: successfully saved {len(latest_data.get('users', []))} users")
            except Exception as e:
                print(f"[DEBUG] Direct write: error saving file: {e}")

def _force_write_now(data: dict):
    """Force immediate write (for shutdown)"""
    global _write_timer, _write_queue
    
    with _write_lock:
        # Cancel any pending timer
        if _write_timer:
            _write_timer.cancel()
            _write_timer = None
        
        # Clear queue and write immediately
        _write_queue.clear()
        
        try:
            paths.USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(paths.USERS_FILE, "w", encoding="utf-8", newline='') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.flush()
            print(f"[DEBUG] Force write: successfully saved {len(data.get('users', []))} users")
        except Exception as e:
            print(f"[DEBUG] Force write: error saving file: {e}")


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
    """Simple direct write with debouncing to prevent rapid-fire writes"""
    print(f"[DEBUG] _save_raw: queueing write for {len(data.get('users', []))} users")
    _queue_write(data)


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
    
    # Set activeUserId if not set
    if not data.get("activeUserId"):
        data["activeUserId"] = user["id"]
    
    # Update isActive flags to match activeUserId
    active_id = data.get("activeUserId")
    for u in data["users"]:
        u["isActive"] = u["id"] == active_id
    
    _save_raw(data)


def remove_user(user_id: str):
    data = _load_raw()
    data["users"] = [u for u in data.get("users", []) if u["id"] != user_id]
    
    # Update activeUserId if the removed user was active
    if data.get("activeUserId") == user_id:
        data["activeUserId"] = data["users"][0]["id"] if data["users"] else None
    
    # Update isActive flags to match the new activeUserId
    active_id = data.get("activeUserId")
    for u in data["users"]:
        u["isActive"] = u["id"] == active_id if active_id else False
    
    _save_raw(data)


def set_active_user(user_id: str):
    print(f"[DEBUG] set_active_user: setting {user_id} as active")
    
    # Serialize all user operations to prevent race conditions
    with _operation_lock:
        data = _load_raw()
        old_active_id = data.get("activeUserId")
        data["activeUserId"] = user_id
        
        # Update isActive flags to match activeUserId
        for user in data.get("users", []):
            user["isActive"] = user["id"] == user_id
        
        print(f"[DEBUG] set_active_user: changed from {old_active_id} to {user_id}")
        
        # Force immediate write for setActiveUser to ensure state is updated
        _force_write_now(data)


def update_tokens(user_id: str, access_token: str, refresh_token: str):
    """Update just the tokens for a user (called after token refresh)."""
    print(f"[DEBUG] update_tokens: updating tokens for {user_id}")
    
    # Serialize all user operations to prevent race conditions
    with _operation_lock:
        data = _load_raw()
        active_user_id = data.get("activeUserId")
        
        for u in data.get("users", []):
            if u["id"] == user_id:
                # Check if this user is currently the active one
                is_currently_active = u["id"] == active_user_id
                print(f"[DEBUG] update_tokens: found user {user_id}, activeUserId={active_user_id}, preserving isActive: {is_currently_active}")
                u["accessToken"]  = access_token
                u["refreshToken"] = refresh_token
                # Set isActive based on current activeUserId, not what's in the user object
                u["isActive"] = is_currently_active
                break
        else:
            print(f"[DEBUG] update_tokens: user {user_id} not found in users list")
        _save_raw(data)


def save_on_shutdown():
    """Force save any pending writes before shutdown"""
    print("[DEBUG] save_on_shutdown: forcing final save")
    
    # Cancel any pending timer immediately
    global _write_timer, _write_queue
    try:
        with _write_lock:
            if _write_timer:
                _write_timer.cancel()
                _write_timer = None
            _write_queue.clear()
    except Exception as e:
        print(f"[DEBUG] Error canceling timer: {e}")
    
    # Simple immediate write - no queuing, no delays, no locks
    try:
        data = _load_raw()
        paths.USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(paths.USERS_FILE, "w", encoding="utf-8", newline='') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
        print(f"[DEBUG] save_on_shutdown: successfully saved {len(data.get('users', []))} users")
    except Exception as e:
        print(f"[DEBUG] save_on_shutdown: error saving file: {e}")
    
    # Force exit to prevent hanging
    import os
    os._exit(0)


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

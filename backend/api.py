"""
api.py – the pywebview JS API surface.

Every public method on LauncherAPI becomes callable from the React frontend
via window.pywebview.api.<method>(...).

All methods must be synchronous from pywebview's perspective (pywebview handles
calling them on a thread pool). We use threading internally where needed.
"""

import json
import platform
import shutil
import subprocess
import threading
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import webview

import paths
from auth.users_store import save_on_shutdown, load_users, save_users, upsert_user, remove_user as _remove_user_store, set_active_user as _set_active_store, update_tokens, get_active_user, get_user
from auth.microsoft import (
    start_login_flow,
    authenticate_from_refresh,
    validate_token,
)
from launcher import instances as inst_mgr
from launcher import versions as ver
from launcher.launch import launch, kill, get_running
from launcher.libraries import install_vanilla_libraries
from java.checker import find_java_installs, get_java_info, validate_for_instance
from mods.modrinth import search_mods, get_mod_versions, install_mod, remove_mod, toggle_mod
from mods.metadata import extract_mod_metadata
from mods.sync import sync_mods_with_instance
from modpack.modrinth import (
    extract_mrpack, validate_modrinth_index, get_modloader_info,
    download_mods, extract_overrides, cleanup_temp_dir
)
from modpack.export import export_instance_to_modpack
import urllib.request
import urllib.parse
import json


def _ok(data=None) -> dict:
    return {"ok": True, "data": data}


def _err(msg: str) -> dict:
    return {"ok": False, "error": msg}


class LauncherAPI:
    """Exposed to JavaScript as window.pywebview.api"""

    def __init__(self, window_ref: list):
        # window_ref is a mutable list so we can set window after creation
        self._window_ref = window_ref
        self._log_store: dict[str, list[dict]] = {}
        self._log_lock   = threading.Lock()
        self._active_users: dict[str, dict] = {}  # userId → user dict

    @property
    def _window(self):
        return self._window_ref[0] if self._window_ref else None

    # ── Window controls ────────────────────────────────────────────────────

    def minimize(self):
        if self._window:
            self._window.minimize()

    def maximize(self):
        if self._window:
            if self._window.maximized:
                self._window.restore()
            else:
                self._window.maximize()

    def quit(self):
        if self._window:
            self._window.destroy()

    # ── Auth ───────────────────────────────────────────────────────────────

    def startMicrosoftLogin(self) -> dict:
        """
        Fully automated login:
          1. Starts localhost:8080 callback server
          2. Opens system browser via Python subprocess
          3. Waits for Microsoft to redirect back with code
          4. Completes Xbox/Minecraft auth chain
          5. Returns User dict

        Progress is pushed to frontend via window.__craftlaunch_auth_progress().
        pywebview calls this on a worker thread so blocking is fine.
        """
        def _progress(msg: str):
            if self._window:
                try:
                    escaped = msg.replace("\\", "\\\\").replace("'", "\\'")
                    self._window.evaluate_js(
                        f"window.__craftlaunch_auth_progress && "
                        f"window.__craftlaunch_auth_progress('{escaped}')"
                    )
                except Exception:
                    pass

        try:
            user = start_login_flow(progress_cb=_progress)
            self._active_users[user["id"]] = user
            # Persist to users.json on disk
            upsert_user(user)
            return _ok(user)
        except Exception as e:
            return _err(str(e))

    def completeMicrosoftLogin(self, code: str) -> dict:
        """Legacy stub — not used in the localhost-callback flow."""
        return _err("Use startMicrosoftLogin() — it handles everything automatically.")

    def refreshUserToken(self, userId: str, refreshToken: str) -> dict:
        try:
            result = authenticate_from_refresh(refreshToken)
            # Update stored user if we have it
            if userId in self._active_users:
                self._active_users[userId]["accessToken"] = result["accessToken"]
                if result.get("refreshToken"):
                    self._active_users[userId]["refreshToken"] = result["refreshToken"]
            
            # IMPORTANT: Also save the updated tokens to users.json
            update_tokens(userId, result["accessToken"], result.get("refreshToken", refreshToken))
            
            return _ok({"accessToken": result["accessToken"],
                        "refreshToken": result.get("refreshToken", refreshToken)})
        except Exception as e:
            return _err(str(e))

    def storeUserTokens(self, userId: str, accessToken: str, refreshToken: str, userObject: dict = None) -> dict:
        """Frontend calls this after loading users from localStorage, so backend has them."""
        if userId not in self._active_users:
            self._active_users[userId] = {}
        
        # Store tokens
        self._active_users[userId]["accessToken"] = accessToken
        self._active_users[userId]["refreshToken"] = refreshToken
        self._active_users[userId]["id"] = userId
        
        # If full user object is provided, merge all user data
        if userObject:
            print(f"DEBUG: Storing full user object for {userId}: {userObject}")
            # Merge all user properties, but don't overwrite tokens
            for key, value in userObject.items():
                if key not in ["accessToken", "refreshToken"]:  # Don't overwrite tokens
                    self._active_users[userId][key] = value
            print(f"DEBUG: Stored user object now has: {self._active_users[userId]}")
        
        # Keep users.json in sync with latest tokens
        update_tokens(userId, accessToken, refreshToken)
        return _ok()

    def getUsersFromDisk(self) -> dict:
        """Read users.json directly from disk and return it.
        Called on startup so the frontend initialises from the authoritative store."""
        try:
            result = load_users()
            print(f"[DEBUG] getUsersFromDisk: loaded {len(result.get('users', []))} users, activeUserId: {result.get('activeUserId')}")
            return _ok(result)
        except Exception as e:
            print(f"[DEBUG] getUsersFromDisk failed: {e}")
            return _err(str(e))

    def saveUsersToDisk(self, users: list, activeUserId: str) -> dict:
        """Persist the full user list from the frontend to users.json."""
        try:
            save_users(users, activeUserId)
            # Also keep in-memory cache fresh
            for u in users:
                self._active_users[u["id"]] = u
            return _ok()
        except Exception as e:
            return _err(str(e))

    def removeUserFromDisk(self, userId: str) -> dict:
        """Remove a user from users.json."""
        try:
            _remove_user_store(userId)
            self._active_users.pop(userId, None)
            return _ok()
        except Exception as e:
            return _err(str(e))

    def setActiveUserOnDisk(self, userId: str) -> dict:
        """Set the active user in users.json."""
        try:
            _set_active_store(userId)
            return _ok()
        except Exception as e:
            return _err(str(e))

    def validateToken(self, accessToken: str) -> dict:
        try:
            valid = validate_token(accessToken)
            return _ok({"valid": valid})
        except Exception as e:
            return _ok({"valid": False})

    # ── Minecraft versions ─────────────────────────────────────────────────

    def getMinecraftVersions(self) -> dict:
        try:
            vs = ver.get_minecraft_versions()
            return _ok(vs)
        except Exception as e:
            return _err(str(e))

    def getAllMinecraftVersions(self) -> dict:
        try:
            vs = ver.get_all_minecraft_versions()
            return _ok(vs)
        except Exception as e:
            return _err(str(e))

    def getVersionsFiltered(self, versionType: str = "release") -> dict:
        try:
            vs = ver.get_versions_filtered(versionType)
            return _ok(vs)
        except Exception as e:
            return _err(str(e))

    def getFabricVersions(self, mcVersion: str) -> dict:
        try:
            vs = ver.get_fabric_versions(mcVersion)
            return _ok(vs)
        except Exception as e:
            return _err(str(e))

    def getForgeVersions(self, mcVersion: str) -> dict:
        try:
            vs = ver.get_forge_versions(mcVersion)
            return _ok(vs)
        except Exception as e:
            return _err(str(e))

    def getNeoForgeVersions(self, mcVersion: str) -> dict:
        try:
            vs = ver.get_neoforge_versions(mcVersion)
            return _ok(vs)
        except Exception as e:
            return _err(str(e))

    def getQuiltVersions(self, mcVersion: str) -> dict:
        try:
            vs = ver.get_quilt_versions(mcVersion)
            return _ok(vs)
        except Exception as e:
            return _err(str(e))

    # ── Instances ──────────────────────────────────────────────────────────

    def getInstances(self) -> dict:
        try:
            items = inst_mgr.get_all()
            running = set(get_running())
            for item in items:
                item["isRunning"] = item["id"] in running
            return _ok(items)
        except Exception as e:
            return _err(str(e))

    def createInstance(self, data: dict) -> dict:
        try:
            instance = inst_mgr.create(
                name               = data.get("name", "New Instance"),
                minecraft_version  = data.get("minecraftVersion", "1.20.1"),
                mod_loader         = data.get("modLoader", "vanilla"),
                mod_loader_version = data.get("modLoaderVersion") or None,
                java_path          = data.get("javaPath") or None,
                jvm_args           = data.get("jvmArgs", ""),
                ram                = int(data.get("ram", 2048)),
                description        = data.get("description", ""),
                lwjgl_override     = data.get("lwjglOverride") or None,
            )
            return _ok(instance)
        except Exception as e:
            return _err(str(e))

    def importModpack(self, mrpack_file_info) -> dict:
        """
        Import a Modrinth modpack (.mrpack file).
        
        The frontend passes a file object with name and base64 content.
        """
        temp_dir = None
        try:
            # Handle different input formats
            if isinstance(mrpack_file_info, dict):
                # File object from frontend with base64 content
                file_name = mrpack_file_info.get('name', 'modpack.mrpack')
                base64_content = mrpack_file_info.get('content', '')
                
                if not base64_content:
                    return _err("No file content provided")
                
                # Decode base64 content
                import base64
                try:
                    file_content = base64.b64decode(base64_content)
                except Exception as e:
                    return _err(f"Failed to decode file content: {e}")
                
                # Write to temporary file
                import tempfile
                temp_file = tempfile.NamedTemporaryFile(suffix='.mrpack', delete=False)
                temp_file.write(file_content)
                temp_file.close()
                mrpack_path = Path(temp_file.name)
                
            elif isinstance(mrpack_file_info, str):
                # Simple file path string (fallback)
                mrpack_path = Path(mrpack_file_info)
            else:
                return _err("Invalid file information provided")
            
            # Extract and parse modpack
            temp_dir, index = extract_mrpack(mrpack_path)
            
            # Validate index structure
            validate_modrinth_index(index)
            
            # Extract metadata
            pack_name = index.get("name", "Imported Modpack")
            pack_version = index.get("versionId", "unknown")
            minecraft_version = index.get("dependencies", {}).get("minecraft", "1.20.1")
            
            # Get modloader information
            modloader, modloader_version = get_modloader_info(index)
            
            # Create instance with modpack metadata
            instance = inst_mgr.create(
                name=f"{pack_name} ({pack_version})",
                minecraft_version=minecraft_version,
                mod_loader=modloader,
                mod_loader_version=modloader_version,
                description=f"Imported from modpack: {pack_name}"
            )
            
            # Download all mods
            downloaded_mods = download_mods(index, temp_dir)
            
            # Install mods to the instance
            for mod_file in downloaded_mods:
                try:
                    # Create a basic mod entry for installation
                    mod_entry = {
                        "id": str(uuid.uuid4()),
                        "name": mod_file.stem,
                        "filename": mod_file.name,
                        "version": "imported",
                        "enabled": True
                    }
                    
                    # Copy mod file to instance mods directory
                    instance_mods_dir = paths.instance_mods_dir(instance["id"])
                    instance_mods_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(mod_file, instance_mods_dir / mod_file.name)
                    
                    # Add mod to instance metadata
                    inst_mgr.add_mod(instance["id"], mod_entry)
                    
                except Exception as e:
                    print(f"Warning: Failed to install mod {mod_file.name}: {e}")
            
            # Extract overrides folder
            instance_dir = paths.instance_dir(instance["id"])
            extract_overrides(temp_dir, instance_dir)
            
            # Clean up temporary directory
            cleanup_temp_dir(temp_dir)
            
            return _ok(instance)
            
        except Exception as e:
            # Clean up temp directory on error
            if temp_dir:
                cleanup_temp_dir(temp_dir)
            return _err(str(e))

    def exportModpack(self, instanceId: str) -> dict:
        """
        Export an instance to a Modrinth modpack (.mrpack) file.
        """
        try:
            # Get instance data
            instance = inst_mgr.get(instanceId)
            
            # Skip vanilla instances
            if instance.get("modLoader") == "vanilla":
                return _err("Cannot export vanilla instances to modpack")
            
            # Export instance to modpack
            modpack_path = export_instance_to_modpack(instanceId, instance)
            
            # Open folder containing the modpack
            self.openFolder(str(modpack_path.parent))
            
            return _ok({
                "modpackPath": str(modpack_path),
                "modpackName": modpack_path.name
            })
            
        except Exception as e:
            return _err(str(e))

    def searchModpacks(self, query: str, offset: int = 0) -> dict:
        """
        Search for modpacks on Modrinth.
        """
        try:
            # Modrinth API endpoint for searching projects
            url = f"https://api.modrinth.com/v2/search"
            
            # Build query parameters
            params = {
                'query': query,
                'facets': json.dumps([["project_type:modpack"]]),
                'limit': 20,
                'offset': offset
            }
            
            # Make API request
            encoded_params = urllib.parse.urlencode(params)
            full_url = f"{url}?{encoded_params}"
            
            req = urllib.request.Request(
                full_url,
                headers={
                    'User-Agent': 'CraftLaunch/1.0'
                }
            )
            
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode('utf-8'))
                return _ok(data)
                
        except Exception as e:
            return _err(str(e))

    def getModpackVersions(self, projectId: str) -> dict:
        """
        Get versions for a specific modpack.
        """
        try:
            url = f"https://api.modrinth.com/v2/project/{projectId}/version"
            
            req = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'CraftLaunch/1.0'
                }
            )
            
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode('utf-8'))
                return _ok(data)
                
        except Exception as e:
            return _err(str(e))

    def getModpackVersionDetails(self, versionId: str) -> dict:
        """
        Get details for a specific modpack version.
        """
        try:
            url = f"https://api.modrinth.com/v2/version/{versionId}"
            
            req = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'CraftLaunch/1.0'
                }
            )
            
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode('utf-8'))
                return _ok(data)
                
        except Exception as e:
            return _err(str(e))

    def syncMods(self, instanceId: str) -> dict:
        """
        Sync instance mods with actual files in mods folder.
        This fixes issues where metadata doesn't match actual mods.
        """
        try:
            print(f"API: Syncing mods for instance {instanceId}")
            
            # Sync mods with actual files
            updated_instance = sync_mods_with_instance(instanceId)
            
            mods_count = len(updated_instance.get("mods", []))
            print(f"API: Sync complete. Instance now has {mods_count} mods")
            
            return _ok(updated_instance)
            
        except Exception as e:
            print(f"API: Error syncing mods: {e}")
            return _err(str(e))

    def getResourcePacks(self, instanceId: str) -> dict:
        """
        Get all resource packs by scanning the resourcepacks folder.
        """
        try:
            print(f"API: Getting resource packs for instance {instanceId}")
            
            # Get the resourcepacks directory
            resourcepacks_dir = paths.instance_dir(instanceId) / "resourcepacks"
            print(f"  Resourcepacks directory: {resourcepacks_dir}")
            print(f"  Directory exists: {resourcepacks_dir.exists()}")
            
            if not resourcepacks_dir.exists():
                print(f"  Resourcepacks directory not found: {resourcepacks_dir}")
                return _ok([])
            
            # Scan for all ZIP files
            packs = []
            zip_files = list(resourcepacks_dir.glob("*.zip"))
            print(f"  Found {len(zip_files)} files with .zip extension")
            
            for zip_path in zip_files:
                if zip_path.is_file() and zip_path.suffix.lower() == '.zip':
                    print(f"  Processing pack: {zip_path.name}")
                    # Create pack entry from file
                    pack_id = zip_path.stem.replace(' ', '_').lower()
                    pack_entry = {
                        "id": pack_id,
                        "filename": zip_path.name,
                        "name": zip_path.stem,
                        "enabled": True,  # Default to enabled
                        "iconUrl": None
                    }
                    packs.append(pack_entry)
                    print(f"    Added pack: {pack_entry['name']} (ID: {pack_id})")
            
            print(f"  Returning {len(packs)} resource packs total")
            return _ok(packs)
            
        except Exception as e:
            print(f"  Error getting resource packs: {e}")
            import traceback
            traceback.print_exc()
            return _err(str(e))

    def getShaderPacks(self, instanceId: str) -> dict:
        """
        Get all shader packs by scanning the shaderpacks folder.
        """
        try:
            print(f"API: Getting shader packs for instance {instanceId}")
            
            # Get the shaderpacks directory
            shaderpacks_dir = paths.instance_dir(instanceId) / "shaderpacks"
            print(f"  Shaderpacks directory: {shaderpacks_dir}")
            print(f"  Directory exists: {shaderpacks_dir.exists()}")
            
            if not shaderpacks_dir.exists():
                print(f"  Shaderpacks directory not found: {shaderpacks_dir}")
                return _ok([])
            
            # Scan for all ZIP files
            packs = []
            zip_files = list(shaderpacks_dir.glob("*.zip"))
            print(f"  Found {len(zip_files)} files with .zip extension")
            
            for zip_path in zip_files:
                if zip_path.is_file() and zip_path.suffix.lower() == '.zip':
                    print(f"  Processing pack: {zip_path.name}")
                    # Create pack entry from file
                    pack_id = zip_path.stem.replace(' ', '_').lower()
                    pack_entry = {
                        "id": pack_id,
                        "filename": zip_path.name,
                        "name": zip_path.stem,
                        "enabled": True,  # Default to enabled
                        "iconUrl": None
                    }
                    packs.append(pack_entry)
                    print(f"    Added pack: {pack_entry['name']} (ID: {pack_id})")
            
            print(f"  Returning {len(packs)} shader packs total")
            return _ok(packs)
            
        except Exception as e:
            print(f"  Error getting shader packs: {e}")
            import traceback
            traceback.print_exc()
            return _err(str(e))

    def importResourcePack(self, instanceId: str, fileInfo: dict) -> dict:
        """
        Import a resource pack from uploaded file to a specific instance.
        """
        try:
            print(f"API: Importing resource pack {fileInfo['name']} to instance {instanceId}")
            
            # Decode base64 content
            import base64
            file_content = base64.b64decode(fileInfo['content'])
            
            # Get instance resourcepacks directory
            resourcepacks_dir = paths.instance_dir(instanceId) / "resourcepacks"
            resourcepacks_dir.mkdir(parents=True, exist_ok=True)
            
            # Save the resource pack
            file_path = resourcepacks_dir / fileInfo['name']
            
            with open(file_path, 'wb') as f:
                f.write(file_content)
            
            print(f"  Saved resource pack to: {file_path}")
            
            return _ok({
                "message": "Resource pack imported successfully",
                "filename": fileInfo['name'],
                "path": str(file_path)
            })
            
        except Exception as e:
            print(f"  Error importing resource pack: {e}")
            return _err(str(e))

    def importShaderPack(self, instanceId: str, fileInfo: dict) -> dict:
        """
        Import a shader pack from uploaded file to a specific instance.
        """
        try:
            print(f"API: Importing shader pack {fileInfo['name']} to instance {instanceId}")
            
            # Decode base64 content
            import base64
            file_content = base64.b64decode(fileInfo['content'])
            
            # Get instance shaderpacks directory
            shaderpacks_dir = paths.instance_dir(instanceId) / "shaderpacks"
            shaderpacks_dir.mkdir(parents=True, exist_ok=True)
            
            # Save the shader pack
            file_path = shaderpacks_dir / fileInfo['name']
            
            with open(file_path, 'wb') as f:
                f.write(file_content)
            
            print(f"  Saved shader pack to: {file_path}")
            
            return _ok({
                "message": "Shader pack imported successfully",
                "filename": fileInfo['name'],
                "path": str(file_path)
            })
            
        except Exception as e:
            print(f"  Error importing shader pack: {e}")
            return _err(str(e))

    def updateInstance(self, instanceId: str, data: dict) -> dict:
        try:
            instance = inst_mgr.update(instanceId, **data)
            return _ok(instance)
        except Exception as e:
            return _err(str(e))

    def getMods(self, instanceId: str) -> dict:
        """
        Get all mods by scanning the mods folder directly.
        This eliminates the need for separate metadata tracking.
        """
        try:
            print(f"API: Getting all mods for instance {instanceId}")
            
            # Get the mods directory
            mods_dir = paths.instance_mods_dir(instanceId)
            print(f"  Mods directory: {mods_dir}")
            print(f"  Directory exists: {mods_dir.exists()}")
            
            if not mods_dir.exists():
                print(f"  Mods directory not found: {mods_dir}")
                return _ok([])
            
            # Scan for all JAR files
            mods = []
            jar_files = list(mods_dir.glob("*.jar"))
            print(f"  Found {len(jar_files)} files with .jar extension")
            
            for jar_path in jar_files:
                if jar_path.is_file() and jar_path.suffix.lower() == '.jar':
                    print(f"  Processing JAR: {jar_path.name}")
                    # Create mod entry from file
                    mod_id = jar_path.stem.replace(' ', '_').lower()
                    mod_entry = {
                        "id": mod_id,
                        "filename": jar_path.name,
                        "name": jar_path.stem,
                        "version": "unknown",
                        "enabled": True,  # Default to enabled
                        "iconUrl": None
                    }
                    mods.append(mod_entry)
                    print(f"    Added mod: {mod_entry['name']} (ID: {mod_id})")
            
            print(f"  Returning {len(mods)} mods total")
            
            return _ok(mods)
            
        except Exception as e:
            print(f"  Error getting mods: {e}")
            import traceback
            traceback.print_exc()
            return _err(str(e))

    def deleteInstance(self, instanceId: str) -> dict:
        try:
            inst_mgr.delete(instanceId)
            return _ok()
        except Exception as e:
            return _err(str(e))

    # ── Launch ─────────────────────────────────────────────────────────────

    def launchInstance(self, instanceId: str, userId: str) -> dict:
        try:
            instance = inst_mgr.get(instanceId)
            user     = self._active_users.get(userId)
            if not user:
                return _err("User not found – please re-authenticate.")

            # Ensure user has complete profile data (username, uuid)
            # Skip profile refresh for offline accounts
            account_type = user.get("accountType")
            is_offline = account_type == "offline"
            print(f"DEBUG: User accountType: {account_type}, is_offline: {is_offline}")
            print(f"DEBUG: User has username: {bool(user.get('username'))}, has uuid: {bool(user.get('uuid'))}")
            
            # For offline accounts, always generate fallback data without API calls
            if is_offline or account_type is None:
                # Treat None accountType as offline (migration issue or legacy account)
                if account_type is None:
                    print("DEBUG: AccountType is None, treating as offline for safety")
                    # Update the user object to have proper accountType
                    user["accountType"] = "offline"
                else:
                    print("DEBUG: Offline account detected, generating fallback data")
                
                user_id = user.get("id", userId)
                existing_username = user.get("username")
                print(f"DEBUG: Existing username: '{existing_username}'")
                
                # Only use fallback if username is actually missing
                if not existing_username:
                    fallback_username = f"Player_{user_id[:8]}" if user_id else "Player"
                    user["username"] = fallback_username
                    print(f"DEBUG: Using fallback username: '{fallback_username}'")
                else:
                    print(f"DEBUG: Using existing username: '{existing_username}'")
                
                user["uuid"] = user.get("uuid") or (user_id or "00000000-0000-0000-0000-000000000000")
            elif not user.get("username") or not user.get("uuid"):
                print("DEBUG: Online account missing profile data, refreshing...")
                try:
                    # Refresh the user data to get complete profile
                    from auth.microsoft import authenticate_from_refresh
                    refreshed_user = authenticate_from_refresh(user["refreshToken"])
                    # Update the user in active users cache
                    self._active_users[userId] = refreshed_user
                    user = refreshed_user
                    # Also update the stored user data
                    upsert_user(refreshed_user)
                except Exception as e:
                    print(f"Failed to refresh user profile: {e}")
                    # Generate fallback data if refresh fails
                    user_id = user.get("id", userId)
                    user["username"] = f"Player_{user_id[:8]}" if user_id else "Player"
                    user["uuid"] = user_id or "00000000-0000-0000-0000-000000000000"

            def _log_cb(iid: str, level: str, message: str):
                ts = datetime.now(timezone.utc).isoformat()
                entry = {"timestamp": ts, "level": level, "message": message}
                with self._log_lock:
                    if iid not in self._log_store:
                        self._log_store[iid] = []
                    self._log_store[iid] = self._log_store[iid][-999:]
                    self._log_store[iid].append(entry)
                # Push log to frontend via JS eval
                if self._window:
                    try:
                        payload = json.dumps(entry).replace("\\", "\\\\").replace("'", "\\'")
                        self._window.evaluate_js(
                            f"window.__craftlaunch_log && window.__craftlaunch_log('{instanceId}', {payload})"
                        )
                    except Exception:
                        pass

            # Launch in background thread so we can return the PID quickly
            result_holder: list[dict] = [{}]
            ready_event = threading.Event()

            def _do_launch():
                r = launch(instance, user, log_cb=_log_cb, window_ref=self._window)
                result_holder[0] = r
                ready_event.set()
                # Notify frontend of running-state change after launch ends
                if self._window:
                    try:
                        self._window.evaluate_js(
                            f"window.__craftlaunch_state_changed && window.__craftlaunch_state_changed()"
                        )
                    except Exception:
                        pass

            t = threading.Thread(target=_do_launch, daemon=True)
            t.start()
            ready_event.wait(timeout=30)  # Wait up to 30s for PID
            return _ok(result_holder[0])

        except Exception as e:
            traceback.print_exc()
            return _err(str(e))

    def killInstance(self, instanceId: str) -> dict:
        try:
            kill(instanceId)
            return _ok()
        except Exception as e:
            return _err(str(e))

    def getRunningInstances(self) -> dict:
        try:
            return _ok(get_running())
        except Exception as e:
            return _err(str(e))

    # ── Java ───────────────────────────────────────────────────────────────

    def findJava(self) -> dict:
        try:
            javas = find_java_installs()
            print(f"[DEBUG] API findJava: Found {len(javas)} Java installations")
            for i, java in enumerate(javas):
                print(f"[DEBUG] API findJava: {i+1}. {java['path']} - Java {java['version']} ({java['arch']})")
            return _ok(javas)
        except Exception as e:
            print(f"[DEBUG] API findJava error: {e}")
            traceback.print_exc()
            return _err(str(e))

    def checkJava(self, path: str = "") -> dict:
        try:
            info = get_java_info(path) if path else {}
            return _ok(info)
        except Exception as e:
            return _err(str(e))

    def testJava(self, path: str) -> dict:
        """Run java -version on a specific path and return raw output + parsed info."""
        import subprocess
        try:
            result = subprocess.run(
                [path, "-version"],
                capture_output=True, text=True, timeout=10
            )
            raw = (result.stdout + result.stderr).strip()
            info = get_java_info(path)
            info["raw"] = raw
            return _ok(info)
        except FileNotFoundError:
            return _err(f"Java not found at: {path}")
        except Exception as e:
            return _err(str(e))

    def setDefaultJava(self, javaPath: str) -> dict:
        """
        Set the default Java path for all instances.
        """
        try:
            print(f"API: Setting default Java path to: {javaPath}")
            
            # Validate the Java path first
            from java.checker import get_java_info
            java_info = get_java_info(javaPath)
            
            if not java_info.get("valid", False):
                return _err(f"Invalid Java path: {javaPath}")
            
            # Save to a config file or settings
            import json
            config_path = paths.ROOT / "java_config.json"
            config_path.parent.mkdir(parents=True, exist_ok=True)
            
            config = {
                "default_java_path": javaPath,
                "java_info": java_info,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            
            with open(config_path, 'w') as f:
                json.dump(config, f, indent=2)
            
            print(f"  Saved Java config to: {config_path}")
            return _ok({
                "message": "Default Java path set successfully",
                "java_path": javaPath,
                "java_info": java_info
            })
            
        except Exception as e:
            print(f"  Error setting default Java path: {e}")
            return _err(str(e))

    def getDefaultJava(self) -> dict:
        """
        Get the configured default Java path.
        """
        try:
            import json
            config_path = paths.ROOT / "java_config.json"
            
            if config_path.exists():
                with open(config_path, 'r') as f:
                    config = json.load(f)
                return _ok(config)
            else:
                return _ok({})
        except Exception as e:
            return _err(str(e))

    def setInstanceJava(self, instanceId: str, javaPath: str) -> dict:
        """
        Set Java path for a specific instance.
        """
        try:
            print(f"API: Setting Java path for instance {instanceId} to: {javaPath}")
            
            # Validate the Java path first
            from java.checker import get_java_info
            java_info = get_java_info(javaPath)
            
            if not java_info.get("valid", False):
                return _err(f"Invalid Java path: {javaPath}")
            
            # Update instance configuration
            instance = inst_mgr.get(instanceId)
            if not instance:
                return _err(f"Instance not found: {instanceId}")
            
            instance["javaPath"] = javaPath
            inst_mgr.update(instance)
            
            print(f"  Updated instance Java path to: {javaPath}")
            return _ok({
                "message": "Instance Java path set successfully",
                "instance_id": instanceId,
                "java_path": javaPath,
                "java_info": java_info
            })
            
        except Exception as e:
            print(f"  Error setting instance Java path: {e}")
            return _err(str(e))

    def validateJavaForInstance(self, instanceId: str) -> dict:
        try:
            instance = inst_mgr.get(instanceId)
            result   = validate_for_instance(instance)
            return _ok(result)
        except Exception as e:
            return _err(str(e))

    # ── Mods ───────────────────────────────────────────────────────────────

    def searchMods(self, query: str, mcVersion: str, loader: str, offset: int = 0) -> dict:
        try:
            result = search_mods(query, mcVersion, loader, offset)
            return _ok(result)
        except Exception as e:
            return _err(str(e))

    def getModVersions(self, projectId: str, mcVersion: str, loader: str) -> dict:
        try:
            vs = get_mod_versions(projectId, mcVersion or None, loader or None)
            return _ok(vs)
        except Exception as e:
            return _err(str(e))

    def installMod(self, instanceId: str, versionId: str, filename: str, url: str) -> dict:
        try:
            mod = install_mod(instanceId, versionId, filename, url)
            inst_mgr.add_mod(instanceId, mod)
            return _ok(mod)
        except Exception as e:
            return _err(str(e))

    def removeMod(self, instanceId: str, modId: str) -> dict:
        try:
            # Get filename from instance metadata
            instance = inst_mgr.get(instanceId)
            mod      = next((m for m in instance.get("mods", []) if m["id"] == modId), None)
            if mod:
                remove_mod(instanceId, mod["filename"])
                inst_mgr.remove_mod(instanceId, modId)
            return _ok()
        except Exception as e:
            return _err(str(e))

    def toggleMod(self, instanceId: str, modId: str, enabled: bool) -> dict:
        try:
            instance = inst_mgr.get(instanceId)
            mod      = next((m for m in instance.get("mods", []) if m.get("id") == modId), None)
            if mod:
                toggle_mod(instanceId, mod["filename"], enabled)
                inst_mgr.toggle_mod(instanceId, modId, enabled)
            return _ok()
        except Exception as e:
            return _err(str(e))

    def searchResourcePacks(self, query: str, offset: int = 0) -> dict:
        """
        Search for resource packs on Modrinth.
        """
        try:
            # Modrinth API endpoint for searching projects
            url = f"https://api.modrinth.com/v2/search"
            
            # Build query parameters
            params = {
                'query': query,
                'facets': json.dumps([["project_type:resourcepack"]]),
                'limit': 20,
                'offset': offset
            }
            
            # Make API request
            encoded_params = urllib.parse.urlencode(params)
            full_url = f"{url}?{encoded_params}"
            
            req = urllib.request.Request(
                full_url,
                headers={
                    'User-Agent': 'CraftLaunch/1.0'
                }
            )
            
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode('utf-8'))
                return _ok(data)
                
        except Exception as e:
            return _err(str(e))

    def searchShaderPacks(self, query: str, offset: int = 0) -> dict:
        """
        Search for shader packs on Modrinth.
        """
        try:
            # Modrinth API endpoint for searching projects
            url = f"https://api.modrinth.com/v2/search"
            
            # Build query parameters
            params = {
                'query': query,
                'facets': json.dumps([["project_type:shader"]]),
                'limit': 20,
                'offset': offset
            }
            
            # Make API request
            encoded_params = urllib.parse.urlencode(params)
            full_url = f"{url}?{encoded_params}"
            
            req = urllib.request.Request(
                full_url,
                headers={
                    'User-Agent': 'CraftLaunch/1.0'
                }
            )
            
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode('utf-8'))
                return _ok(data)
                
        except Exception as e:
            return _err(str(e))

    def removeResourcePack(self, instanceId: str, filename: str) -> dict:
        """
        Remove a resource pack file from the instance.
        """
        try:
            print(f"API: Removing resource pack {filename} from instance {instanceId}")
            
            # Get instance resourcepacks directory
            resourcepacks_dir = paths.instance_dir(instanceId) / "resourcepacks"
            
            # Remove the file
            file_path = resourcepacks_dir / filename
            if file_path.exists():
                file_path.unlink()
                print(f"  Removed resource pack: {file_path}")
                return _ok({"message": "Resource pack removed successfully"})
            else:
                return _err("Resource pack file not found")
                
        except Exception as e:
            print(f"  Error removing resource pack: {e}")
            return _err(str(e))

    def removeShaderPack(self, instanceId: str, filename: str) -> dict:
        """
        Remove a shader pack file from the instance.
        """
        try:
            print(f"API: Removing shader pack {filename} from instance {instanceId}")
            
            # Get instance shaderpacks directory
            shaderpacks_dir = paths.instance_dir(instanceId) / "shaderpacks"
            
            # Remove the file
            file_path = shaderpacks_dir / filename
            if file_path.exists():
                file_path.unlink()
                print(f"  Removed shader pack: {file_path}")
                return _ok({"message": "Shader pack removed successfully"})
            else:
                return _err("Shader pack file not found")
                
        except Exception as e:
            print(f"  Error removing shader pack: {e}")
            return _err(str(e))

    def toggleResourcePack(self, instanceId: str, filename: str, enabled: bool) -> dict:
        """
        Enable or disable a resource pack by renaming the file.
        """
        try:
            print(f"API: Toggling resource pack {filename} to {enabled} for instance {instanceId}")
            
            # Get instance resourcepacks directory
            resourcepacks_dir = paths.instance_dir(instanceId) / "resourcepacks"
            file_path = resourcepacks_dir / filename
            
            if not file_path.exists():
                return _err("Resource pack file not found")
            
            # Toggle by adding/removing .disabled extension
            if enabled and filename.endswith('.disabled'):
                # Enable by removing .disabled extension
                new_filename = filename[:-9]  # Remove '.disabled'
                new_path = resourcepacks_dir / new_filename
                file_path.rename(new_path)
                print(f"  Enabled resource pack: {new_filename}")
            elif not enabled and not filename.endswith('.disabled'):
                # Disable by adding .disabled extension
                new_filename = f"{filename}.disabled"
                new_path = resourcepacks_dir / new_filename
                file_path.rename(new_path)
                print(f"  Disabled resource pack: {new_filename}")
            
            return _ok({"message": f"Resource pack {'enabled' if enabled else 'disabled'} successfully"})
                
        except Exception as e:
            print(f"  Error toggling resource pack: {e}")
            return _err(str(e))

    def toggleShaderPack(self, instanceId: str, filename: str, enabled: bool) -> dict:
        """
        Enable or disable a shader pack by renaming the file.
        """
        try:
            print(f"API: Toggling shader pack {filename} to {enabled} for instance {instanceId}")
            
            # Get instance shaderpacks directory
            shaderpacks_dir = paths.instance_dir(instanceId) / "shaderpacks"
            file_path = shaderpacks_dir / filename
            
            if not file_path.exists():
                return _err("Shader pack file not found")
            
            # Toggle by adding/removing .disabled extension
            if enabled and filename.endswith('.disabled'):
                # Enable by removing .disabled extension
                new_filename = filename[:-9]  # Remove '.disabled'
                new_path = shaderpacks_dir / new_filename
                file_path.rename(new_path)
                print(f"  Enabled shader pack: {new_filename}")
            elif not enabled and not filename.endswith('.disabled'):
                # Disable by adding .disabled extension
                new_filename = f"{filename}.disabled"
                new_path = shaderpacks_dir / new_filename
                file_path.rename(new_path)
                print(f"  Disabled shader pack: {new_filename}")
            
            return _ok({"message": f"Shader pack {'enabled' if enabled else 'disabled'} successfully"})
                
        except Exception as e:
            print(f"  Error toggling shader pack: {e}")
            return _err(str(e))

    def getModMetadata(self, instanceId: str, modId: str) -> dict:
        """
        Extract metadata from a mod JAR file by scanning the mods folder directly.
        This eliminates the need for separate metadata tracking.
        """
        try:
            print(f"API: Getting metadata for mod {modId} in instance {instanceId}")
            
            # Get the mods directory
            mods_dir = paths.instance_mods_dir(instanceId)
            
            if not mods_dir.exists():
                print(f"  Mods directory not found: {mods_dir}")
                return _err("Mods directory not found")
            
            # Find the mod file by ID (scan all JAR files)
            mod_file = None
            for jar_path in mods_dir.glob("*.jar"):
                if jar_path.is_file() and jar_path.suffix.lower() == '.jar':
                    # Create a simple ID from filename for comparison
                    file_id = jar_path.stem.replace(' ', '_').lower()
                    if file_id == modId or jar_path.name == modId:
                        mod_file = jar_path
                        break
            
            if not mod_file:
                print(f"  Mod file not found for ID: {modId}")
                return _err("Mod file not found")
            
            print(f"  Processing mod file: {mod_file}")
            
            # Extract metadata from JAR
            metadata = extract_mod_metadata(mod_file)
            
            # Create display data
            display_data = {
                "id": mod_file.stem,
                "filename": mod_file.name,
                "name": mod_file.stem,
                "version": "unknown",
                "enabled": True,  # Default to enabled
                "extractedMetadata": metadata,
                "displayName": metadata.get("name", mod_file.stem),
                "displayVersion": metadata.get("version", "unknown"),
                "displayAuthor": metadata.get("author", "Unknown"),
                "displayDescription": metadata.get("description", ""),
                "modloader": metadata.get("modloader", "unknown"),
                "mcversion": metadata.get("mcversion", "unknown"),
                "hasIcon": metadata.get("has_icon", False),
                "iconFilename": metadata.get("icon_filename", ""),
                "iconSize": metadata.get("icon_size", 0)
            }
            
            # Remove binary data from metadata to prevent JSON serialization issues
            clean_metadata = metadata.copy()
            clean_metadata.pop("_binary_icon", None)
            display_data["extractedMetadata"] = clean_metadata
            
            print(f"  Successfully processed mod: {display_data.get('displayName', 'Unknown')}")
            return _ok(display_data)
            
        except Exception as e:
            print(f"  Error processing mod {modId}: {e}")
            return _err(str(e))

    def getModIcon(self, instanceId: str, modId: str) -> dict:
        """
        Get mod icon data as base64 for display in the UI.
        """
        try:
            print(f"API: Getting icon for mod {modId} in instance {instanceId}")
            
            # Get the mods directory
            mods_dir = paths.instance_mods_dir(instanceId)
            if not mods_dir.exists():
                return _err("Instance mods directory not found")
            
            # Find the mod file
            mod_file = None
            for file_path in mods_dir.glob("*.jar"):
                # Use filename (without extension) as mod ID for matching
                file_mod_id = file_path.stem
                if file_mod_id == modId or file_mod_id.startswith(modId):
                    mod_file = file_path
                    break
            
            if not mod_file:
                return _err(f"Mod file not found for {modId}")
            
            print(f"  Processing mod file: {mod_file}")
            
            # Extract metadata from JAR
            metadata = extract_mod_metadata(mod_file)
            
            # Check if icon was extracted
            binary_icon = metadata.get("_binary_icon")
            if not binary_icon:
                return _err("No icon found in mod")
            
            # Get icon metadata
            filename = metadata.get("icon_filename", "icon.png")
            icon_size = metadata.get("icon_size", len(binary_icon))
            
            # Convert icon data to base64 for frontend
            import base64
            icon_base64 = base64.b64encode(binary_icon).decode('utf-8')
            if filename.lower().endswith('.png'):
                mime_type = "image/png"
            elif filename.lower().endswith('.jpg') or filename.lower().endswith('.jpeg'):
                mime_type = "image/jpeg"
            elif filename.lower().endswith('.gif'):
                mime_type = "image/gif"
            else:
                mime_type = "image/png"  # Default to PNG
            
            icon_response = {
                "filename": filename,
                "size": icon_size,
                "mimeType": mime_type,
                "data": f"data:{mime_type};base64,{icon_base64}"
            }
            
            print(f"  Successfully extracted icon: {filename} ({icon_size} bytes)")
            return _ok(icon_response)
            
        except Exception as e:
            print(f"  Error extracting icon for mod {modId}: {e}")
            return _err(str(e))

    # ── Logs ───────────────────────────────────────────────────────────────

    def openLogWindow(self, instanceId: str, instanceName: str) -> dict:
        """Open a separate pywebview window showing live logs for an instance."""
        try:
            import os
            web_dir = os.path.join(os.path.dirname(__file__), "web")
            # Build the log window URL — points to the same frontend with a hash route
            if os.path.exists(os.path.join(web_dir, "index.html")):
                url = f"file://{web_dir}/index.html#log/{instanceId}"
            else:
                url = f"http://localhost:5173/#log/{instanceId}"

            win = webview.create_window(
                title=f"Logs – {instanceName}",
                url=url,
                js_api=self,          # share the same API so getLogs works
                width=820,
                height=540,
                min_size=(600, 360),
                frameless=False,      # OS-native frame for the log window
                background_color="#0e0f14",
            )
            return _ok({"opened": True})
        except Exception as e:
            return _err(str(e))

    def getLogs(self, instanceId: str) -> dict:
        with self._log_lock:
            logs = list(self._log_store.get(instanceId, []))
        return _ok(logs)

    def clearLogs(self, instanceId: str) -> dict:
        with self._log_lock:
            self._log_store[instanceId] = []
        return _ok()

    def getLogsAsText(self, instanceId: str) -> dict:
        """Get logs as formatted text for copying."""
        with self._log_lock:
            logs = list(self._log_store.get(instanceId, []))
        
        if not logs:
            return _ok("No logs available.")
        
        # Format logs as text
        lines = []
        for log in logs:
            timestamp = log.get("timestamp", "")
            if timestamp:
                # Extract time part (HH:MM:SS) from ISO timestamp
                time_str = timestamp[11:19]
            else:
                time_str = "??:??:??"
            
            level = log.get("level", "INFO")
            message = log.get("message", "")
            lines.append(f"{time_str} [{level}] {message}")
        
        return _ok("\n".join(lines))

    # ── System ─────────────────────────────────────────────────────────────

    def getSystemInfo(self) -> dict:
        sys = platform.system()
        machine = platform.machine().lower()
        return _ok({
            "os":       sys.lower(),
            "arch":     "arm64" if machine in ("arm64", "aarch64") else "x64",
            "platform": sys,
        })

    def openFolder(self, folderPath: str) -> dict:
        try:
            p = Path(folderPath)
            if not p.exists():
                p.mkdir(parents=True, exist_ok=True)
            if platform.system() == "Darwin":
                subprocess.Popen(["open", str(p)])
            elif platform.system() == "Windows":
                subprocess.Popen(["explorer", str(p)])
            else:
                subprocess.Popen(["xdg-open", str(p)])
            return _ok()
        except Exception as e:
            return _err(str(e))

    def getInstanceDir(self, instanceId: str) -> dict:
        return _ok(str(paths.instance_dir(instanceId)))

    def shutdown(self) -> dict:
        """Save any pending data before shutdown"""
        try:
            save_on_shutdown()
            return _ok()
        except Exception as e:
            return _err(str(e))

    def getDataDir(self) -> dict:
        return _ok(str(paths.ROOT))

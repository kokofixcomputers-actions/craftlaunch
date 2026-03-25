"""
launcher/instances.py – create, read, update, delete instances.

Each instance lives in instances/<id>/instance.json.
The directory structure for a running instance:
  instances/<id>/
    instance.json   ← metadata + mod list
    mods/           ← mod jars (instance-specific)
    config/
    saves/
    screenshots/
    logs/
    resourcepacks/
    shaderpacks/

Libraries are NOT stored here – they live in libraries/shared/... and
libraries/minecraft/... and are shared across all instances with the same
mc version + modloader version.
"""

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import paths


def _instance_json_path(instance_id: str) -> Path:
    return paths.instance_dir(instance_id) / "instance.json"


def _load(instance_id: str) -> dict:
    p = _instance_json_path(instance_id)
    if not p.exists():
        raise FileNotFoundError(f"Instance {instance_id} not found")
    with open(p) as f:
        return json.load(f)


def _save(data: dict):
    idir = paths.instance_dir(data["id"])
    idir.mkdir(parents=True, exist_ok=True)
    # Ensure sub-directories exist
    for sub in ("mods", "config", "saves", "screenshots", "logs", "resourcepacks", "shaderpacks"):
        (idir / sub).mkdir(exist_ok=True)
    with open(idir / "instance.json", "w") as f:
        json.dump(data, f, indent=2)


def get_all() -> list[dict]:
    """Return all instances sorted by creation date."""
    print(f"instances.get_all: Retrieving all instances")
    instances = []
    if not paths.INSTANCES_DIR.exists():
        print(f"instances.get_all: No instances directory found")
        return instances
    for idir in paths.INSTANCES_DIR.iterdir():
        jp = idir / "instance.json"
        if jp.exists():
            try:
                with open(jp) as f:
                    d = json.load(f)
                # Runtime-only field – never persisted
                d["isRunning"] = False
                d["processPid"] = None
                mods_count = len(d.get("mods", []))
                print(f"instances.get_all: Found instance {d.get('name', 'unknown')} with {mods_count} mods")
                instances.append(d)
            except Exception as e:
                print(f"instances.get_all: Error loading instance {idir.name}: {e}")
                pass
    instances.sort(key=lambda x: x.get("createdAt", ""))
    print(f"instances.get_all: Returning {len(instances)} instances")
    return instances


def create(
    name: str,
    minecraft_version: str,
    mod_loader: str = "vanilla",
    mod_loader_version: Optional[str] = None,
    java_path: Optional[str] = None,
    jvm_args: str = "",
    ram: int = 2048,
    description: str = "",
    lwjgl_override: Optional[str] = None,
) -> dict:
    instance_id = str(uuid.uuid4())
    data = {
        "id":               instance_id,
        "name":             name,
        "minecraftVersion": minecraft_version,
        "modLoader":        mod_loader,
        "modLoaderVersion": mod_loader_version or "",
        "javaPath":         java_path or "",
        "jvmArgs":          jvm_args,
        "ram":              ram,
        "mods":             [],
        "createdAt":        datetime.now(timezone.utc).isoformat(),
        "lastPlayed":       None,
        "icon":             "",
        "description":      description,
        "lwjglOverride":    lwjgl_override or "",
    }
    _save(data)
    data["isRunning"] = False
    data["processPid"] = None
    return data


def get(instance_id: str) -> dict:
    print(f"instances.get: Retrieving instance {instance_id}")
    d = _load(instance_id)
    d["isRunning"]  = False
    d["processPid"] = None
    
    mods_count = len(d.get("mods", []))
    print(f"instances.get: Instance {instance_id} has {mods_count} mods")
    
    if mods_count > 0:
        print(f"instances.get: First few mods: {[mod.get('filename', 'unknown') for mod in d.get('mods', [])[:3]]}")
    
    return d


def update(instance_id: str, **kwargs) -> dict:
    d = _load(instance_id)
    # Only allow updating these fields
    allowed = {
        "name", "javaPath", "jvmArgs", "ram", "description",
        "icon", "lwjglOverride", "modLoaderVersion",
        "minecraftVersion", "modLoader",
    }
    for k, v in kwargs.items():
        if k in allowed:
            d[k] = v
    _save(d)
    d["isRunning"]  = False
    d["processPid"] = None
    return d


def delete(instance_id: str):
    idir = paths.instance_dir(instance_id)
    if idir.exists():
        shutil.rmtree(idir)


def add_mod(instance_id: str, mod: dict) -> dict:
    d = _load(instance_id)
    # Remove any existing entry with same versionId or filename
    d["mods"] = [m for m in d.get("mods", [])
                 if m.get("versionId") != mod.get("versionId")
                 and m.get("filename") != mod.get("filename")]
    d["mods"].append(mod)
    _save(d)
    return d


def remove_mod(instance_id: str, mod_id: str) -> dict:
    d = _load(instance_id)
    d["mods"] = [m for m in d.get("mods", []) if m.get("id") != mod_id]
    _save(d)
    return d


def toggle_mod(instance_id: str, mod_id: str, enabled: bool) -> dict:
    d = _load(instance_id)
    for m in d.get("mods", []):
        if m.get("id") == mod_id:
            m["enabled"] = enabled
    _save(d)
    return d


def update_last_played(instance_id: str):
    try:
        d = _load(instance_id)
        d["lastPlayed"] = datetime.now(timezone.utc).isoformat()
        _save(d)
    except Exception:
        pass

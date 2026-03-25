"""
mods/modrinth.py – search and install mods from Modrinth.

Mods are installed into the instance's mods/ directory (per-instance).
The mod metadata is stored in the instance's instance.json.
"""

import hashlib
import json
import shutil
from pathlib import Path
from typing import Optional

import requests

import paths

MODRINTH_API = "https://api.modrinth.com/v2"


def _loader_for_api(loader: str) -> str:
    """Normalize loader name for Modrinth API."""
    return {
        "vanilla": "",
        "fabric":  "fabric",
        "forge":   "forge",
        "neoforge": "neoforge",
        "quilt":   "quilt",
    }.get(loader, loader)


def search_mods(
    query: str,
    mc_version: str,
    loader: str,
    offset: int = 0,
    limit: int = 20,
) -> dict:
    """Search Modrinth for mods matching query/version/loader."""
    facets = [["project_type:mod"]]
    if mc_version:
        facets.append([f"versions:{mc_version}"])
    api_loader = _loader_for_api(loader)
    if api_loader:
        facets.append([f"categories:{api_loader}"])

    params: dict = {
        "query":  query,
        "facets": json.dumps(facets),
        "offset": offset,
        "limit":  limit,
    }
    resp = requests.get(f"{MODRINTH_API}/search", params=params, timeout=20)
    resp.raise_for_status()
    return resp.json()  # keys: hits, total_hits, offset, limit


def get_mod_versions(
    project_id: str,
    mc_version: Optional[str] = None,
    loader: Optional[str] = None,
) -> list[dict]:
    """List all versions of a Modrinth project, optionally filtered."""
    params: dict = {}
    if mc_version:
        params["game_versions"] = json.dumps([mc_version])
    api_loader = _loader_for_api(loader or "")
    if api_loader:
        params["loaders"] = json.dumps([api_loader])

    resp = requests.get(
        f"{MODRINTH_API}/project/{project_id}/version",
        params=params, timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def get_version_info(version_id: str) -> dict:
    resp = requests.get(f"{MODRINTH_API}/version/{version_id}", timeout=20)
    resp.raise_for_status()
    return resp.json()


def install_mod(
    instance_id: str,
    version_id: str,
    filename: str,
    url: str,
) -> dict:
    """
    Download a mod jar into the instance's mods/ directory.
    Returns InstalledMod dict.
    """
    mods_dir = paths.instance_mods_dir(instance_id)
    mods_dir.mkdir(parents=True, exist_ok=True)

    dest = mods_dir / filename
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    tmp = dest.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        for chunk in resp.iter_content(65536):
            f.write(chunk)
    tmp.replace(dest)

    import uuid
    mod_id = str(uuid.uuid4())

    # Fetch version info for metadata
    try:
        vinfo = get_version_info(version_id)
        project_id  = vinfo.get("project_id", "")
        version_num = vinfo.get("version_number", version_id)
        name        = vinfo.get("name", filename)
    except Exception:
        project_id  = ""
        version_num = version_id
        name        = filename

    return {
        "id":        mod_id,
        "name":      name,
        "slug":      project_id,
        "version":   version_num,
        "versionId": version_id,
        "filename":  filename,
        "enabled":   True,
        "iconUrl":   "",
    }


def remove_mod(instance_id: str, filename: str):
    """Delete a mod jar from the instance's mods/ directory."""
    mods_dir = paths.instance_mods_dir(instance_id)
    target = mods_dir / filename
    if target.exists():
        target.unlink()
    # Also remove .disabled variant
    disabled = mods_dir / (filename + ".disabled")
    if disabled.exists():
        disabled.unlink()


def toggle_mod(instance_id: str, filename: str, enabled: bool):
    """
    Enable/disable a mod by renaming its file:
      enabled:  foo.jar
      disabled: foo.jar.disabled
    """
    mods_dir = paths.instance_mods_dir(instance_id)
    jar      = mods_dir / filename
    disabled = mods_dir / (filename + ".disabled")

    if enabled:
        if disabled.exists():
            disabled.rename(jar)
    else:
        if jar.exists():
            jar.rename(disabled)

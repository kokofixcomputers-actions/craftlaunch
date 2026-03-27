"""
modpack/export.py – export instances to Modrinth modpack (.mrpack) files.
"""

import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, List, Any
import urllib.request

import paths


def _sha1(file_path: Path) -> str:
    h = hashlib.sha1()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha512(file_path: Path) -> str:
    h = hashlib.sha512()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _lookup_modrinth_hashes(sha1_hashes: List[str]) -> Dict[str, Any]:
    """
    POST to Modrinth version_files endpoint.
    Returns dict keyed by sha1 hash → version object.
    """
    if not sha1_hashes:
        return {}
    try:
        body = json.dumps({
            "hashes": sha1_hashes,
            "algorithm": "sha1",
        }).encode()
        req = urllib.request.Request(
            "https://api.modrinth.com/v2/version_files",
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "CraftLaunch/1.0"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"Modrinth hash lookup failed: {e}")
        return {}


def export_instance_to_modpack(instance_id: str, instance_data: Dict[str, Any]) -> Path:
    if instance_data.get("modLoader") == "vanilla":
        raise ValueError("Cannot export vanilla instances to modpack")

    mods_dir = paths.instance_mods_dir(instance_id)
    mod_files = sorted(mods_dir.glob("*.jar")) if mods_dir.exists() else []

    # --- hash every mod ---
    mod_hashes: Dict[str, Path] = {}  # sha1 → path
    for p in mod_files:
        mod_hashes[_sha1(p)] = p

    # --- ask Modrinth which ones it knows ---
    modrinth_data = _lookup_modrinth_hashes(list(mod_hashes.keys()))
    # response is keyed by sha1 hash

    index_files = []
    override_mods: List[Path] = []

    for sha1, mod_path in mod_hashes.items():
        version = modrinth_data.get(sha1)
        if version:
            # Find the matching file entry in the version
            vfile = next(
                (f for f in version.get("files", [])
                 if f.get("hashes", {}).get("sha1") == sha1),
                version.get("files", [{}])[0],
            )
            index_files.append({
                "path": f"mods/{mod_path.name}",
                "hashes": {
                    "sha1":   vfile.get("hashes", {}).get("sha1", sha1),
                    "sha512": vfile.get("hashes", {}).get("sha512", _sha512(mod_path)),
                },
                "downloads": [vfile["url"]] if vfile.get("url") else [],
                "fileSize": mod_path.stat().st_size,
            })
        else:
            print(f"  Not on Modrinth, adding to overrides: {mod_path.name}")
            override_mods.append(mod_path)

    # --- build index ---
    mc_version = instance_data.get("minecraftVersion", "1.20.1")
    loader     = instance_data.get("modLoader", "fabric")
    loader_ver = instance_data.get("modLoaderVersion", "")

    dependencies: Dict[str, str] = {"minecraft": mc_version}
    if loader != "vanilla" and loader_ver:
        dependencies[loader] = loader_ver

    index = {
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": "1.0.0",
        "name": instance_data.get("name", "Exported Instance"),
        "summary": f"Exported from CraftLaunch",
        "dependencies": dependencies,
        "files": index_files,
    }

    # --- package into .mrpack ---
    instance_dir = paths.instance_dir(instance_id)
    temp_dir = Path(tempfile.mkdtemp(prefix="modpack_export_"))
    try:
        # modrinth.index.json
        with open(temp_dir / "modrinth.index.json", "w") as f:
            json.dump(index, f, indent=2)

        # overrides/mods — only mods not found on Modrinth
        if override_mods:
            override_mods_dir = temp_dir / "overrides" / "mods"
            override_mods_dir.mkdir(parents=True)
            for p in override_mods:
                shutil.copy2(p, override_mods_dir / p.name)

        # overrides — config, saves, resourcepacks, shaderpacks, etc. (not mods)
        for sub in ("config", "saves", "resourcepacks", "shaderpacks"):
            src = instance_dir / sub
            if src.exists() and any(src.iterdir()):
                shutil.copytree(src, temp_dir / "overrides" / sub, dirs_exist_ok=True)

        # write zip
        safe_name = instance_data.get("name", "modpack").replace(" ", "_")
        paths.TEMP_DIR.mkdir(parents=True, exist_ok=True)
        out_path = paths.TEMP_DIR / f"{safe_name}.mrpack"
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for fp in temp_dir.rglob("*"):
                if fp.is_file():
                    zf.write(fp, fp.relative_to(temp_dir))

        return out_path
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

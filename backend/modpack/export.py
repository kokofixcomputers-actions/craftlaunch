"""
modpack/export.py – export instances to Modrinth modpack (.mrpack) files.

This module provides functionality to:
1. Calculate SHA1 hashes of mod files
2. Query Modrinth API for version information
3. Generate modrinth.index.json
4. Create .mrpack files with mods and overrides
"""

import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Any
import urllib.request
import urllib.parse

import paths


def calculate_sha1(file_path: Path) -> str:
    """Calculate SHA1 hash of a file."""
    sha1_hash = hashlib.sha1()
    try:
        with open(file_path, "rb") as f:
            # Read file in chunks to handle large files
            for chunk in iter(lambda: f.read(4096), b""):
                sha1_hash.update(chunk)
        return sha1_hash.hexdigest()
    except Exception as e:
        print(f"Error calculating SHA1 for {file_path}: {e}")
        return ""


def get_modrinth_version_info(hashes: List[str]) -> Dict[str, Any]:
    """
    Query Modrinth API to get version information from SHA1 hashes.
    """
    if not hashes:
        return {}
    
    try:
        # Prepare request data
        request_data = json.dumps({"hashes": hashes}).encode('utf-8')
        
        # Make API request
        url = "https://api.modrinth.com/v2/version_files"
        req = urllib.request.Request(
            url,
            data=request_data,
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'CraftLaunch/1.0'
            }
        )
        
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
            
    except Exception as e:
        print(f"Error querying Modrinth API: {e}")
        return {}


def generate_modrinth_index(instance_data: Dict[str, Any], mod_files: List[Path], 
                          version_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate modrinth.index.json content.
    """
    # Extract instance information
    minecraft_version = instance_data.get("minecraftVersion", "1.20.1")
    modloader = instance_data.get("modLoader", "fabric")
    modloader_version = instance_data.get("modLoaderVersion", "")
    
    # Build dependencies object
    dependencies = {"minecraft": minecraft_version}
    if modloader != "vanilla" and modloader_version:
        dependencies[modloader] = modloader_version
    
    # Build files array
    files = []
    for mod_file in mod_files:
        sha1_hash = calculate_sha1(mod_file)
        if not sha1_hash:
            continue
            
        # Try to get version info from Modrinth API
        version_data = version_info.get(sha1_hash, {})
        
        # Use API data if available, otherwise create basic entry
        if version_data:
            files.append({
                "path": f"mods/{mod_file.name}",
                "hashes": {
                    "sha1": version_data.get("files", [{}])[0].get("hashes", {}).get("sha1", sha1_hash),
                    "sha512": version_data.get("files", [{}])[0].get("hashes", {}).get("sha512", "")
                },
                "downloads": [version_data.get("files", [{}])[0].get("url", "")],
                "fileSize": mod_file.stat().st_size
            })
        else:
            # Create basic entry for unknown mods
            files.append({
                "path": f"mods/{mod_file.name}",
                "hashes": {
                    "sha1": sha1_hash,
                    "sha512": ""
                },
                "downloads": [],
                "fileSize": mod_file.stat().st_size
            })
    
    # Generate index
    index = {
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": "exported-1.0.0",
        "name": f"Exported {instance_data.get('name', 'Instance')}",
        "summary": f"Exported from {instance_data.get('name', 'Instance')} using CraftLaunch",
        "dependencies": dependencies,
        "files": files
    }
    
    return index


def create_modpack_file(instance_id: str, index: Dict[str, Any], 
                       include_overrides: bool = True) -> Path:
    """
    Create .mrpack file with mods and optionally overrides.
    """
    # Get instance paths
    instance_dir = paths.instance_dir(instance_id)
    mods_dir = paths.instance_mods_dir(instance_id)
    
    # Create temporary directory for packaging
    temp_dir = Path(tempfile.mkdtemp(prefix="modpack_export_"))
    
    try:
        # Write modrinth.index.json
        index_file = temp_dir / "modrinth.index.json"
        with open(index_file, 'w', encoding='utf-8') as f:
            json.dump(index, f, indent=2)
        
        # Create mods directory and copy mod files
        mods_export_dir = temp_dir / "mods"
        mods_export_dir.mkdir(exist_ok=True)
        
        for file_info in index.get("files", []):
            mod_path = instance_dir / file_info["path"]
            if mod_path.exists():
                shutil.copy2(mod_path, mods_export_dir / Path(file_info["path"]).name)
        
        # Copy overrides folder if requested
        if include_overrides:
            overrides_dir = instance_dir / "overrides"
            if overrides_dir.exists():
                shutil.copytree(overrides_dir, temp_dir / "overrides", dirs_exist_ok=True)
        
        # Create .mrpack file
        modpack_name = f"{index.get('name', 'modpack').replace(' ', '_')}.mrpack"
        modpack_path = paths.TEMP_DIR / modpack_name
        
        with zipfile.ZipFile(modpack_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for file_path in temp_dir.rglob('*'):
                if file_path.is_file():
                    arcname = file_path.relative_to(temp_dir)
                    zip_file.write(file_path, arcname)
        
        return modpack_path
        
    finally:
        # Clean up temporary directory
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)


def export_instance_to_modpack(instance_id: str, instance_data: Dict[str, Any],
                             include_overrides: bool = True) -> Path:
    """
    Export an instance to a Modrinth modpack (.mrpack) file.
    """
    # Skip vanilla instances
    if instance_data.get("modLoader") == "vanilla":
        raise ValueError("Cannot export vanilla instances to modpack")
    
    # Get mod files
    mods_dir = paths.instance_mods_dir(instance_id)
    if not mods_dir.exists():
        raise ValueError("No mods directory found")
    
    mod_files = list(mods_dir.glob("*.jar"))
    if not mod_files:
        raise ValueError("No mod files found")
    
    # Calculate hashes and get version info
    hashes = []
    for mod_file in mod_files:
        sha1_hash = calculate_sha1(mod_file)
        if sha1_hash:
            hashes.append(sha1_hash)
    
    # Query Modrinth API
    version_info = get_modrinth_version_info(hashes)
    
    # Generate index
    index = generate_modrinth_index(instance_data, mod_files, version_info)
    
    # Create modpack file
    return create_modpack_file(instance_id, index, include_overrides)

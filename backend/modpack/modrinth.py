"""
modpack/modrinth.py – handle Modrinth modpack (.mrpack) files.

This module provides functionality to:
1. Extract .mrpack files (which are ZIP archives)
2. Parse modrinth.index.json for metadata
3. Download mods from the specified URLs
4. Create instances with correct configuration
"""

import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import urllib.request
import urllib.parse

import paths


def extract_mrpack(mrpack_path: Path) -> Tuple[Path, Dict]:
    """
    Extract a .mrpack file to a temporary directory and parse the index.
    
    Returns:
        Tuple of (temp_dir_path, modrinth_index_dict)
    """
    if not mrpack_path.exists():
        raise FileNotFoundError(f"Modpack file not found: {mrpack_path}")
    
    if not mrpack_path.suffix == '.mrpack':
        raise ValueError(f"Invalid modpack file extension: {mrpack_path.suffix}")
    
    # Create temporary directory for extraction
    temp_dir = Path(tempfile.mkdtemp(prefix="mrpack_", dir=paths.TEMP_DIR))
    
    try:
        # Extract the ZIP file
        with zipfile.ZipFile(mrpack_path, 'r') as zip_file:
            zip_file.extractall(temp_dir)
        
        # Parse modrinth.index.json
        index_path = temp_dir / "modrinth.index.json"
        if not index_path.exists():
            raise FileNotFoundError("modrinth.index.json not found in modpack")
        
        with open(index_path, 'r') as f:
            index_data = json.load(f)
        
        return temp_dir, index_data
    
    except Exception as e:
        # Clean up temp directory on error
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise e


def validate_modrinth_index(index: Dict) -> None:
    """
    Validate the modrinth.index.json structure.
    """
    required_fields = ["game", "formatVersion", "versionId", "name", "files", "dependencies"]
    
    for field in required_fields:
        if field not in index:
            raise ValueError(f"Missing required field in modrinth.index.json: {field}")
    
    if index["game"] != "minecraft":
        raise ValueError(f"Unsupported game: {index['game']}")
    
    if index["formatVersion"] != 1:
        raise ValueError(f"Unsupported format version: {index['formatVersion']}")


def get_modloader_info(index: Dict) -> Tuple[str, Optional[str]]:
    """
    Extract modloader information from the dependencies.
    
    Returns:
        Tuple of (modloader_type, modloader_version)
    """
    dependencies = index.get("dependencies", {})
    
    # Check for forge
    if "forge" in dependencies:
        return "forge", dependencies["forge"]
    
    # Check for fabric
    if "fabric-loader" in dependencies:
        return "fabric", dependencies["fabric-loader"]
    
    # Check for neoforge
    if "neoforge" in dependencies:
        return "neoforge", dependencies["neoforge"]
    
    # Check for quilt
    if "quilt-loader" in dependencies:
        return "quilt", dependencies["quilt-loader"]
    
    # Default to vanilla
    return "vanilla", None


def download_file(url: str, destination: Path, expected_sha1: Optional[str] = None) -> None:
    """
    Download a file from URL with optional SHA1 verification.
    """
    try:
        urllib.request.urlretrieve(url, destination)
    except Exception as e:
        raise RuntimeError(f"Failed to download {url}: {e}")
    
    # Verify SHA1 if provided
    if expected_sha1:
        sha1_hash = hashlib.sha1()
        with open(destination, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                sha1_hash.update(chunk)
        
        actual_sha1 = sha1_hash.hexdigest()
        if actual_sha1 != expected_sha1:
            destination.unlink(missing_ok=True)
            raise ValueError(f"SHA1 verification failed for {destination.name}: expected {expected_sha1}, got {actual_sha1}")


def download_mods(index: Dict, temp_dir: Path) -> List[Path]:
    """
    Download all mods from the modpack index.
    
    Returns:
        List of paths to downloaded mod files
    """
    downloaded_files = []
    files = index.get("files", [])
    
    for file_info in files:
        downloads = file_info.get("downloads", [])
        if not downloads:
            print(f"Warning: No download URLs for file: {file_info.get('path', 'unknown')}")
            continue
        
        # Use the first download URL
        url = downloads[0]
        path = file_info.get("path", "")
        hashes = file_info.get("hashes", {})
        expected_sha1 = hashes.get("sha1")
        
        # Determine filename from path
        filename = Path(path).name
        if not filename:
            # Generate filename from URL if path is empty
            filename = urllib.parse.urlparse(url).path.split('/')[-1]
            if not filename:
                filename = f"mod_{len(downloaded_files)}.jar"
        
        destination = temp_dir / "downloads" / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            download_file(url, destination, expected_sha1)
            downloaded_files.append(destination)
            print(f"Downloaded: {filename}")
        except Exception as e:
            print(f"Warning: Failed to download {filename}: {e}")
            continue
    
    return downloaded_files


def extract_overrides(temp_dir: Path, instance_dir: Path) -> None:
    """
    Extract overrides folder to instance directory.
    Copies everything from overrides folder (including subfolders) to instance directory with overwrite.
    """
    overrides_dir = temp_dir / "overrides"
    if not overrides_dir.exists():
        return
    
    # Copy everything from overrides to instance directory with overwrite
    for item in overrides_dir.iterdir():
        if item.is_file():
            shutil.copy2(item, instance_dir / item.name)
        elif item.is_dir():
            # Copy directory recursively with overwrite
            dest_dir = instance_dir / item.name
            if dest_dir.exists():
                shutil.rmtree(dest_dir)
            shutil.copytree(item, dest_dir, dirs_exist_ok=True)


def cleanup_temp_dir(temp_dir: Path) -> None:
    """
    Clean up temporary directory.
    """
    if temp_dir.exists():
        shutil.rmtree(temp_dir, ignore_errors=True)

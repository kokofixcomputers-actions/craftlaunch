"""
mods/metadata.py – extract mod metadata from JAR files.

This module provides functionality to:
1. Extract JAR files to temporary directories
2. Parse mcmod.info (Forge mods)
3. Parse mod.json (Fabric mods)
4. Return standardized mod metadata
"""

import json
import shutil
import tempfile
import zipfile
import hashlib
from pathlib import Path
from typing import Dict, Optional, Any
from functools import lru_cache

# Simple in-memory cache for mod metadata
_mod_metadata_cache: Dict[str, Dict[str, Any]] = {}


def extract_mod_metadata(jar_path: Path) -> Dict[str, Any]:
    """
    Extract metadata from a mod JAR file.
    
    Supports:
    - Forge: mcmod.info
    - Fabric: fabric.mod.json
    
    Returns standardized metadata dict.
    """
    print(f"Extracting metadata from: {jar_path.name}")
    
    # Skip ZIP files - they're not mod JAR files
    if jar_path.suffix.lower() == '.zip':
        print(f"  Skipping ZIP file: {jar_path.name}")
        return {"error": "ZIP file - not a mod JAR"}
    
    if not jar_path.exists() or jar_path.suffix != '.jar':
        print(f"  File not found or not JAR: {jar_path}")
        return {}

    print("proxessing")
    
    # Create cache key based on file path and modification time
    try:
        mtime = jar_path.stat().st_mtime
        cache_key = f"{jar_path}_{mtime}"
        
        # Check cache first
        if cache_key in _mod_metadata_cache:
            print(f"  Using cached metadata for {jar_path.name}")
            return _mod_metadata_cache[cache_key]
    except OSError:
        pass
    
    temp_dir = None
    try:
        # Create temporary directory for extraction
        temp_dir = Path(tempfile.mkdtemp(prefix="mod_meta_"))
        print(f"  Created temp directory: {temp_dir}")
        
        # Extract JAR file with size limits to prevent issues with large JARs
        with zipfile.ZipFile(jar_path, 'r') as zip_file:
            # Only extract metadata files to speed up processing
            metadata_files = ['mcmod.info', 'fabric.mod.json']
            extracted_files = []
            icon_files = []
            
            for file_info in zip_file.infolist():
                # Skip directories and non-metadata files
                if file_info.is_dir():
                    continue
                
                # Extract metadata files we need
                if any(meta_file in file_info.filename for meta_file in metadata_files):
                    try:
                        zip_file.extract(file_info, temp_dir)
                        extracted_files.append(file_info.filename)
                        print(f"  Extracted: {file_info.filename}")
                    except Exception as e:
                        print(f"  Failed to extract {file_info.filename}: {e}")
                        continue
                
                # Look for icon files (png, jpg, jpeg, gif)
                elif any(file_info.filename.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif']):
                    # Only extract if it looks like an icon (not in subdirectories)
                    if '/' not in file_info.filename or file_info.filename.count('/') == 1:
                        icon_files.append(file_info)
                        print(f"  Found icon: {file_info.filename}")
            
            if not extracted_files:
                print(f"  No metadata files found in JAR")
        
        # Try Forge mcmod.info first
        forge_info = temp_dir / "mcmod.info"
        if forge_info.exists():
            print(f"  Found Forge metadata file")
            metadata = _parse_forge_metadata(forge_info)
        else:
            # Try nested directories for Forge
            print(f"  Looking for Forge metadata in nested directories...")
            for nested_dir in temp_dir.iterdir():
                if nested_dir.is_dir():
                    nested_forge = nested_dir / "mcmod.info"
                    if nested_forge.exists():
                        print(f"  Found Forge metadata in nested directory")
                        metadata = _parse_forge_metadata(nested_forge)
                        break
            else:
                print(f"  No Forge metadata found")
                metadata = {}
        
        # If no Forge metadata found, try Fabric
        if not metadata:
            fabric_info = temp_dir / "fabric.mod.json"
            if fabric_info.exists():
                print(f"  Found Fabric metadata file")
                metadata = _parse_fabric_metadata(fabric_info)
            else:
                # Try nested directories for Fabric
                print(f"  Looking for Fabric metadata in nested directories...")
                for nested_dir in temp_dir.iterdir():
                    if nested_dir.is_dir():
                        nested_fabric = nested_dir / "fabric.mod.json"
                        if nested_fabric.exists():
                            print(f"  Found Fabric metadata in nested directory")
                            metadata = _parse_fabric_metadata(nested_fabric)
                            break
                else:
                    print(f"  No Fabric metadata found")
                    metadata = {}
        
        # If still no metadata, create basic info
        if not metadata:
            print(f"  No metadata found, creating basic info")
            metadata = {
                "modid": jar_path.stem,
                "name": jar_path.stem,
                "description": "",
                "version": "unknown",
                "mcversion": "unknown",
                "author": "unknown",
                "modloader": "unknown"
            }
        else:
            print(f"  Successfully extracted metadata: {metadata.get('name', 'Unknown')}")
        
        # Extract icon if specified in metadata or found in JAR
        icon_path = metadata.get("icon", "")
        extracted_icon = None
        
        if icon_path:
            # Try to extract the specified icon file
            print(f"  Looking for icon: {icon_path}")
            try:
                with zipfile.ZipFile(jar_path, 'r') as zip_file:
                    for file_info in zip_file.infolist():
                        if file_info.filename == icon_path or file_info.filename.endswith(icon_path):
                            try:
                                icon_data = zip_file.read(file_info.filename)
                                extracted_icon = {
                                    "filename": Path(file_info.filename).name,
                                    "data": icon_data,
                                    "size": len(icon_data)
                                }
                                print(f"  Extracted icon: {file_info.filename}")
                                break
                            except Exception as e:
                                print(f"  Failed to extract icon {file_info.filename}: {e}")
            except Exception as e:
                print(f"  Error extracting icon: {e}")
        
        # If no icon specified, try to find one automatically
        if not extracted_icon and icon_files:
            print(f"  Using automatically found icon")
            icon_file = icon_files[0]  # Use the first icon found
            try:
                with zipfile.ZipFile(jar_path, 'r') as zip_file:
                    icon_data = zip_file.read(icon_file.filename)
                    extracted_icon = {
                        "filename": Path(icon_file.filename).name,
                        "data": icon_data,
                        "size": len(icon_data)
                    }
                    print(f"  Extracted auto-found icon: {icon_file.filename}")
            except Exception as e:
                print(f"  Failed to extract auto-found icon: {e}")
        
        # Add icon data to metadata (but exclude binary data from JSON response)
        if extracted_icon:
            metadata["has_icon"] = True
            metadata["icon_filename"] = extracted_icon["filename"]
            metadata["icon_size"] = extracted_icon["size"]
            # Store binary data separately for the icon endpoint
            metadata["_binary_icon"] = extracted_icon["data"]
        else:
            metadata["has_icon"] = False
        
        # Cache the result
        try:
            _mod_metadata_cache[cache_key] = metadata
            # Limit cache size to prevent memory issues
            if len(_mod_metadata_cache) > 1000:
                # Remove oldest entries (simple FIFO)
                oldest_keys = list(_mod_metadata_cache.keys())[:500]
                for key in oldest_keys:
                    del _mod_metadata_cache[key]
        except Exception:
            pass
        
        return metadata
        
    except Exception as e:
        print(f"Error extracting metadata from {jar_path}: {e}")
        return {"error": str(e)}
    finally:
        if temp_dir and temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)


def _parse_forge_metadata(info_path: Path) -> Dict[str, Any]:
    """Parse Forge mcmod.info file."""
    try:
        with open(info_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Try to parse as JSON first (newer Forge versions)
        try:
            data = json.loads(content)
            data = data[0]
            # Handle both list and dict formats for authors
            authors = data.get("authorList", data.get("authors", []))
            if isinstance(authors, list):
                author_list = authors
            else:
                author_list = [authors] if authors else []
            
            return {
                "modid": data.get("modid", ""),
                "name": data.get("name", ""),
                "description": data.get("description", ""),
                "version": data.get("version", ""),
                "mcversion": data.get("mcversion", ""),
                "author": _format_authors(author_list),
                "modloader": "forge"
            }
        except json.JSONDecodeError:
            pass
        
        # Try to parse as Java properties format (older Forge versions)
        return _parse_java_properties(content)
        
    except Exception as e:
        print(f"Error parsing Forge metadata: {e}")
        return {}


def _parse_fabric_metadata(info_path: Path) -> Dict[str, Any]:
    """Parse Fabric fabric.mod.json file."""
    try:
        with open(info_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Fabric mod is a single object, not an array
        # Remove the incorrect data[0] access
        
        # Extract authors properly - can be array of strings or objects
        authors = data.get("authors", [])
        author_list = []
        if isinstance(authors, list):
            for author in authors:
                if isinstance(author, str):
                    author_list.append(author)
                elif isinstance(author, dict):
                    # Handle author objects with name field
                    author_list.append(author.get("name", "Unknown"))
        
        # Extract Minecraft version from depends
        mc_version = "unknown"
        depends = data.get("depends", {})
        if isinstance(depends, dict):
            minecraft_dep = depends.get("minecraft")
            if isinstance(minecraft_dep, dict):
                mc_version = minecraft_dep.get("version", "unknown")
            elif isinstance(minecraft_dep, str):
                mc_version = minecraft_dep
        
        # Extract icon path if available
        icon_path = data.get("icon", "")
        
        return {
            "modid": data.get("id", ""),
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "version": data.get("version", ""),
            "mcversion": mc_version,
            "author": _format_authors(author_list),
            "modloader": "fabric",
            "icon": icon_path,
            "authors": author_list,  # Keep original authors list for display
            "license": data.get("license", ""),
            "contact": data.get("contact", {}),
            "environment": data.get("environment", "*")
        }
        
    except Exception as e:
        print(f"Error parsing Fabric metadata: {e}")
        return {}


def _parse_java_properties(content: str) -> Dict[str, Any]:
    """Parse Java properties format from mcmod.info."""
    data = {}
    for line in content.split('\n'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            data[key.strip()] = value.strip().strip('"')
    
    # Handle author field from properties format
    author = data.get("authorList", data.get("authors", ""))
    
    return {
        "modid": data.get("modid", ""),
        "name": data.get("name", ""),
        "description": data.get("description", ""),
        "version": data.get("version", ""),
        "mcversion": data.get("mcversion", ""),
        "author": author,
        "modloader": "forge"
    }


def _extract_mc_version_from_fabric(data: Dict[str, Any]) -> str:
    """Extract Minecraft version from Fabric mod.json."""
    # Try different ways Fabric stores MC version
    depends = data.get("depends", [])
    if isinstance(depends, list):
        for dep in depends:
            if isinstance(dep, dict) and dep.get("id") == "minecraft":
                return dep.get("version", "")
    elif isinstance(dep, str):
        if dep.startswith("minecraft"):
            return dep.split(" ")[1] if " " in dep else ""
    
    # Try from environment
    environment = data.get("environment", "")
    if "*" in environment:
        return "all"
    
    return "unknown"


def _format_authors(authors: Any) -> str:
    """Format authors list into a string."""
    if isinstance(authors, list):
        if len(authors) == 0:
            return ""
        elif len(authors) == 1:
            return str(authors[0]) if authors[0] else ""
        else:
            return ", ".join(str(a) for a in authors[:3])
    elif isinstance(authors, str):
        return authors
    else:
        return str(authors) if authors else ""

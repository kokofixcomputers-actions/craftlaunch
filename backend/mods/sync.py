"""
mods/sync.py – sync actual mod files with instance metadata.

This module provides functionality to:
1. Scan mods folder for actual JAR files
2. Sync with instance metadata
3. Fix missing mod entries
"""

import json
from pathlib import Path
from typing import Dict, List, Any
import uuid

import paths
from launcher import instances as inst_mgr


def sync_mods_with_instance(instance_id: str) -> Dict[str, Any]:
    """
    Sync actual mod files in the mods folder with instance metadata.
    This fixes issues where the instance metadata doesn't match the actual mods.
    """
    print(f"mods.sync: Syncing mods for instance {instance_id}")
    
    # Get current instance data
    instance = inst_mgr.get(instance_id)
    if not instance:
        print(f"  Instance {instance_id} not found")
        return {}
    
    # Get mods directory
    mods_dir = paths.instance_mods_dir(instance_id)
    if not mods_dir.exists():
        print(f"  Mods directory not found: {mods_dir}")
        return instance
    
    # Scan for actual JAR files (skip ZIP files)
    actual_mod_files = []
    for file_path in mods_dir.glob("*.jar"):
        if file_path.is_file() and file_path.suffix.lower() == '.jar':
            actual_mod_files.append(file_path)
    
    print(f"  Found {len(actual_mod_files)} actual JAR files in mods folder")
    
    # Get current mods from metadata
    current_mods = instance.get("mods", [])
    print(f"  Instance metadata shows {len(current_mods)} mods")
    
    # Create a map of current mods by filename
    current_mods_by_filename = {mod.get("filename", ""): mod for mod in current_mods}
    
    # Find missing mods (files that exist but aren't in metadata)
    missing_mods = []
    for mod_file in actual_mod_files:
        filename = mod_file.name
        if filename not in current_mods_by_filename:
            print(f"  Missing mod in metadata: {filename}")
            # Create a basic mod entry
            missing_mods.append({
                "id": str(uuid.uuid4()),
                "name": mod_file.stem,
                "slug": mod_file.stem,
                "version": "unknown",
                "versionId": "",
                "filename": filename,
                "enabled": True,
                "iconUrl": None
            })
    
    # Find orphaned mods (in metadata but files don't exist)
    orphaned_mods = []
    for mod in current_mods:
        filename = mod.get("filename", "")
        mod_file_path = mods_dir / filename
        if not mod_file_path.exists():
            print(f"  Orphaned mod in metadata: {filename}")
            orphaned_mods.append(mod)
    
    # Update instance metadata
    updated_mods = []
    
    # Keep existing mods that have files
    for mod in current_mods:
        filename = mod.get("filename", "")
        mod_file_path = mods_dir / filename
        if mod_file_path.exists():
            updated_mods.append(mod)
    
    # Add missing mods
    updated_mods.extend(missing_mods)
    
    print(f"  Updated mods list: {len(updated_mods)} total ({len(missing_mods)} added, {len(orphaned_mods)} removed)")
    
    # Save updated instance
    instance["mods"] = updated_mods
    inst_mgr.update(instance_id, instance)
    
    return instance


def scan_all_instances_for_sync() -> None:
    """
    Scan all instances and sync their mods with actual files.
    """
    print("mods.sync: Scanning all instances for mod sync")
    
    all_instances = inst_mgr.get_all()
    for instance in all_instances:
        instance_id = instance.get("id")
        instance_name = instance.get("name", "Unknown")
        
        current_mods = len(instance.get("mods", []))
        
        # Only sync if there might be a mismatch
        mods_dir = paths.instance_mods_dir(instance_id)
        if mods_dir.exists():
            actual_jar_count = len(list(mods_dir.glob("*.jar")))
            
            print(f"\nInstance: {instance_name}")
            print(f"  Metadata mods: {current_mods}")
            print(f"  Actual JAR files: {actual_jar_count}")
            
            if current_mods != actual_jar_count:
                print(f"  Mismatch detected, syncing...")
                sync_mods_with_instance(instance_id)
            else:
                print(f"  No sync needed")
        else:
            print(f"\nInstance: {instance_name}")
            print(f"  No mods directory found")


def fix_instance_mods(instance_id: str) -> Dict[str, Any]:
    """
    Fix mods for a specific instance by syncing with actual files.
    """
    return sync_mods_with_instance(instance_id)

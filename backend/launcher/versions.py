"""
launcher/versions.py – fetch version lists from all upstreams.

Vanilla versions:   https://launchermeta.mojang.com/mc/game/version_manifest_v2.json
Fabric:             https://meta.fabricmc.net/v2/versions/loader/<mc_version>
Forge:              https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml
NeoForge:           https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml
Quilt:              https://meta.quiltmc.org/v3/versions/loader/<mc_version>
"""

import functools
import re
import time
import xml.etree.ElementTree as ET
from typing import Optional

import requests

MOJANG_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
FABRIC_META     = "https://meta.fabricmc.net/v2/versions/loader"
FORGE_META = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"
NEOFORGE_META   = "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"
QUILT_META      = "https://meta.quiltmc.org/v3/versions/loader"

_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 300  # 5 minutes


def _cached_get(url: str, timeout: int = 20) -> dict | list:
    now = time.time()
    if url in _cache:
        ts, data = _cache[url]
        if now - ts < _CACHE_TTL:
            return data  # type: ignore
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    ct = resp.headers.get("Content-Type", "")
    data = resp.json() if "json" in ct or url.endswith(".json") else resp.text
    _cache[url] = (now, data)
    return data  # type: ignore


# ─── Vanilla ────────────────────────────────────────────────────────────────

def get_minecraft_versions(include_snapshots: bool = False) -> list[dict]:
    manifest = _cached_get(MOJANG_MANIFEST)
    versions = []
    for v in manifest["versions"]:  # type: ignore
        if not include_snapshots and v["type"] not in ("release", "old_alpha", "old_beta"):
            # include releases + old versions but filter snapshots by default
            pass
        if v["type"] in ("release",) or (include_snapshots and v["type"] == "snapshot"):
            versions.append({
                "id":          v["id"],
                "type":        v["type"],
                "releaseTime": v["releaseTime"],
                "url":         v["url"],
            })
    return versions


def get_all_minecraft_versions() -> list[dict]:
    """All types including snapshots, alphas, betas."""
    manifest = _cached_get(MOJANG_MANIFEST)
    return [
        {
            "id":          v["id"],
            "type":        v["type"],
            "releaseTime": v["releaseTime"],
            "url":         v["url"],
        }
        for v in manifest["versions"]
    ]



def get_versions_filtered(version_type: str = "release") -> list[dict]:
    """
    Fetch versions from Mojang piston-data filtered by type.
    version_type: "release" | "snapshot" | "old_beta" | "old_alpha" | "all"
    Returns list sorted newest first.
    """
    manifest = _cached_get(MOJANG_MANIFEST)
    result = []
    for v in manifest["versions"]:
        if version_type == "all" or v["type"] == version_type:
            result.append({
                "id":          v["id"],
                "type":        v["type"],
                "releaseTime": v["releaseTime"],
                "url":         v["url"],
            })
    return result

def get_version_manifest(mc_version: str) -> dict:
    """Fetch the full version JSON for a specific MC version."""
    manifest = _cached_get(MOJANG_MANIFEST)
    for v in manifest["versions"]:  # type: ignore
        if v["id"] == mc_version:
            return _cached_get(v["url"])  # type: ignore
    raise ValueError(f"Unknown Minecraft version: {mc_version}")


# ─── Fabric ─────────────────────────────────────────────────────────────────

def get_fabric_versions(mc_version: str) -> list[dict]:
    url  = f"{FABRIC_META}/{mc_version}"
    data = _cached_get(url)
    return [
        {
            "id":     entry["loader"]["version"],
            "loader": "fabric",
            "stable": entry["loader"]["stable"],
        }
        for entry in data  # type: ignore
    ]


def get_fabric_profile_url(mc_version: str, loader_version: str) -> str:
    return (
        f"https://meta.fabricmc.net/v2/versions/loader/"
        f"{mc_version}/{loader_version}/profile/json"
    )


# ─── Forge ──────────────────────────────────────────────────────────────────

def get_forge_versions(mc_version: str) -> list[dict]:
    xml_text = _cached_get(FORGE_META)
    root     = ET.fromstring(xml_text)  # type: ignore
    versions = []
    for v in root.iter("version"):
        text = v.text or ""
        # Forge versions look like "1.20.1-47.2.0"
        if text.startswith(mc_version + "-"):
            forge_ver = text.split("-", 1)[1]
            versions.append({
                "id":     forge_ver,
                "full":   text,
                "loader": "forge",
                "stable": True,
            })
    # newest first
    return sorted(versions, key=lambda x: x["id"], reverse=True)[:30]


def get_forge_installer_url(mc_version: str, forge_version: str) -> str:
    full = f"{mc_version}-{forge_version}"
    return (
        f"https://maven.minecraftforge.net/net/minecraftforge/forge/"
        f"{full}/forge-{full}-installer.jar"
    )


# ─── NeoForge ───────────────────────────────────────────────────────────────

def get_neoforge_versions(mc_version: str) -> list[dict]:
    xml_text = _cached_get(NEOFORGE_META)
    root     = ET.fromstring(xml_text)  # type: ignore
    # NeoForge version format: e.g. "21.1.77" for MC 1.21.1
    # The prefix is mc_version without the leading "1." e.g. "21.1"
    short_mc = mc_version.lstrip("1.").replace(".", ".", 1) if mc_version.startswith("1.") else mc_version
    # Simplified: just match versions that start with the minor version pair
    parts = mc_version.split(".")
    if len(parts) >= 2:
        prefix = f"{parts[1]}."
        if len(parts) >= 3:
            prefix = f"{parts[1]}.{parts[2]}."
    else:
        prefix = ""

    versions = []
    for v in root.iter("version"):
        text = v.text or ""
        if text.startswith(prefix):
            versions.append({
                "id":     text,
                "loader": "neoforge",
                "stable": True,
            })
    return sorted(versions, reverse=True)[:30]


def get_neoforge_installer_url(neoforge_version: str) -> str:
    return (
        f"https://maven.neoforged.net/releases/net/neoforged/neoforge/"
        f"{neoforge_version}/neoforge-{neoforge_version}-installer.jar"
    )


# ─── Quilt ──────────────────────────────────────────────────────────────────

def get_quilt_versions(mc_version: str) -> list[dict]:
    url  = f"{QUILT_META}/{mc_version}"
    data = _cached_get(url)
    return [
        {
            "id":     entry["loader"]["version"],
            "loader": "quilt",
            "stable": not entry["loader"]["version"].endswith("-SNAPSHOT"),
        }
        for entry in data  # type: ignore
    ]


def get_quilt_profile_url(mc_version: str, loader_version: str) -> str:
    return (
        f"https://meta.quiltmc.org/v3/versions/loader/"
        f"{mc_version}/{loader_version}/profile/json"
    )

"""
paths.py – canonical directory layout for CraftLaunch

Shared-library layout (key design decision):
  libraries/
    minecraft/<version>/          ← vanilla client jar + JSON
    shared/<mc_version>/<loader>/<loader_version>/
                                  ← modloader jars shared across all instances
    assets/                       ← asset index + objects (shared by all versions)
    lwjgl/<variant>/              ← LWJGL natives (per variant, e.g. lwjgl2-arm64)

Instance layout:
  instances/<id>/
    instance.json                 ← metadata
    mods/                         ← .jar mods (instance-specific)
    config/                       ← mod configs
    saves/                        ← worlds
    screenshots/
    logs/
    resourcepacks/
    shaderpacks/

This means two instances with the same MC version + modloader version share
every library/jar; only mods/, saves/, config/ are per-instance.
"""

import os
import platform
import sys
from pathlib import Path


def _default_data_dir() -> Path:
    system = platform.system()

    # Resolve home directory explicitly — Nuitka/frozen envs can have a broken
    # HOME env var or Path.home() may fall back to a relative path.
    home_str = os.environ.get("HOME") or os.environ.get("USERPROFILE") or ""
    if home_str and not os.path.isabs(home_str):
        home_str = ""  # reject relative paths like "~"
    home = Path(home_str) if home_str else Path(os.path.expanduser("~"))

    # Final safety: if home is still relative, fall back to /tmp
    if not home.is_absolute():
        home = Path("/tmp")

    if system == "Darwin":
        return home / "Library" / "Application Support" / "CraftLaunch"
    elif system == "Windows":
        appdata = os.environ.get("APPDATA", "")
        if appdata and os.path.isabs(appdata):
            return Path(appdata) / "CraftLaunch"
        return home / "AppData" / "Roaming" / "CraftLaunch"
    else:
        return home / ".craftlaunch"


ROOT = _default_data_dir()

USERS_FILE      = ROOT / "users.json"

# Top-level dirs
INSTANCES_DIR   = ROOT / "instances"
LIBRARIES_DIR   = ROOT / "libraries"
JAVA_DIR        = ROOT / "java"
LOGS_DIR        = ROOT / "logs"
TEMP_DIR        = ROOT / "temp"

# Shared library sub-dirs
MC_VERSIONS_DIR  = LIBRARIES_DIR / "minecraft"   # vanilla client jars/JSONs
SHARED_LIBS_DIR  = LIBRARIES_DIR / "shared"      # modloader libs keyed by (mc/loader/version)
ASSETS_DIR       = LIBRARIES_DIR / "assets"      # asset index + objects
LWJGL_DIR        = LIBRARIES_DIR / "lwjgl"       # LWJGL variant overrides
CLASSPATH_DIR    = LIBRARIES_DIR / "classpath"   # vanilla library jars from Mojang manifest


def shared_loader_dir(mc_version: str, loader: str, loader_version: str) -> Path:
    """
    Returns the directory that holds ALL jars for a given
    (minecraft_version, modloader, modloader_version) triple.
    Multiple instances with the same triple share this directory.
    """
    return SHARED_LIBS_DIR / mc_version / loader / loader_version


def instance_dir(instance_id: str) -> Path:
    return INSTANCES_DIR / instance_id


def instance_mods_dir(instance_id: str) -> Path:
    return INSTANCES_DIR / instance_id / "mods"


def instance_config_dir(instance_id: str) -> Path:
    return INSTANCES_DIR / instance_id / "config"


def instance_saves_dir(instance_id: str) -> Path:
    return INSTANCES_DIR / instance_id / "saves"


def instance_logs_dir(instance_id: str) -> Path:
    return INSTANCES_DIR / instance_id / "logs"


def mc_version_dir(mc_version: str) -> Path:
    return MC_VERSIONS_DIR / mc_version


def lwjgl_variant_dir(variant: str) -> Path:
    return LWJGL_DIR / variant


def ensure_dirs():
    for d in [
        INSTANCES_DIR, LIBRARIES_DIR, JAVA_DIR, LOGS_DIR, TEMP_DIR,
        MC_VERSIONS_DIR, SHARED_LIBS_DIR, ASSETS_DIR, LWJGL_DIR, CLASSPATH_DIR,
    ]:
        d.mkdir(parents=True, exist_ok=True)

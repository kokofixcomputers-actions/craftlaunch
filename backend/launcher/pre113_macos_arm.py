# launcher/pre113_macos_arm.py
import subprocess
from pathlib import Path

import requests
import minecraft_launcher_lib
from minecraft_launcher_lib import mod_loader as mll_mod_loader


BASE_URL = (
    "https://github.com/GreeniusGenius/m1-prism-launcher-hack-1.8.9/"
    "raw/refs/heads/master/lwjglnatives"
)
ARM_NATIVES = [
    "liblwjgl.dylib",
    "libopenal.dylib",
    "libjcocoa.dylib",
]


def _patch_arm64_natives(minecraft_dir: Path, version: str) -> Path:
    """Patch ARM64 dylibs into <minecraft_dir>/versions/<version>/natives."""
    natives_dir = minecraft_dir / "versions" / version / "natives"
    natives_dir.mkdir(parents=True, exist_ok=True)

    print(f"[pre113] Patching ARM64 natives into {natives_dir}...")
    for filename in ARM_NATIVES:
        url = f"{BASE_URL}/{filename}"
        dest = natives_dir / filename
        print(f"  Downloading {filename}...")
        resp = requests.get(url, timeout=30)
        if resp.status_code == 200:
            dest.write_bytes(resp.content)
            print(f"  ✓ {filename}")
        else:
            print(f"  ✗ Failed: {filename} (HTTP {resp.status_code})")
    return natives_dir


def _install_forge_via_mod_loader(
    minecraft_dir: Path,
    mc_version: str,
) -> str:
    """
    Use minecraft_launcher_lib.mod_loader to install Forge into minecraft_dir.
    """
    mc_dir_str = str(minecraft_dir)

    loader = mll_mod_loader.get_mod_loader("forge")
    print(f"[pre113] Got mod loader: {loader}")

    latest_loader_version = loader.get_latest_loader_version(mc_version)
    print(
        f"[pre113] Latest Forge loader version for {mc_version}: "
        f"{latest_loader_version}"
    )

    print(f"[pre113] Installing Forge via mod_loader into {mc_dir_str}...")
    forge_profile_id = loader.install(mc_version, mc_dir_str)
    print(f"[pre113] Forge profile id from mod_loader: {forge_profile_id}")
    return forge_profile_id


def main(
    # This should be the **instance root**:
    #   /Users/.../CraftLaunch/instances/<id>
    instance_root: str,
    java_path: str,
    version: str,
    username: str,
    uuid: str,
    token: str,
    loader: str = "vanilla",
    loader_version: str = "",
) -> subprocess.Popen:
    """
    Legacy pre-1.13 path for macOS ARM using minecraft_launcher_lib + mod_loader.
    """
    instance_root_path = Path(instance_root)
    instance_root_path.mkdir(parents=True, exist_ok=True)

    # Use "<instance_root>/minecraft" as the real Minecraft directory
    minecraft_dir = instance_root_path / "minecraft"
    minecraft_dir.mkdir(parents=True, exist_ok=True)

    print(f"[pre113] Using minecraft directory: {minecraft_dir}")

    print(f"[pre113] Ensuring base vanilla {version} is installed...")
    minecraft_launcher_lib.install.install_minecraft_version(
        version,
        str(minecraft_dir),
    )

    launch_version_id: str = version

    if loader == "forge":
        print(f"[pre113] Installing Forge for {version} via mod_loader...")
        launch_version_id = _install_forge_via_mod_loader(
            minecraft_dir,
            version,
        )
        _patch_arm64_natives(minecraft_dir, launch_version_id)
    else:
        _patch_arm64_natives(minecraft_dir, version)

    options = {
        "username": username or "Player",
        "uuid": uuid or "",
        "token": token or "",
        "launcherName": "CraftLaunch",
        "java": java_path,
        # Make the **game directory** be the instance root,
        # so saves/mods/configs live there if you want.
        "gameDirectory": str(instance_root_path),
    }

    print(f"[pre113] Building launch command for {launch_version_id}...")
    command = minecraft_launcher_lib.command.get_minecraft_command(
        launch_version_id,
        str(minecraft_dir),
        options,
    )

    command[0] = java_path

    print("[pre113] Launch command:", " ".join(repr(c) for c in command))

    proc = subprocess.Popen(
        command,
        cwd=str(instance_root_path),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    return proc

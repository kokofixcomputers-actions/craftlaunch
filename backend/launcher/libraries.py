"""
launcher/libraries.py – download and cache shared Minecraft libraries.

Key: libraries are keyed by (mc_version, loader, loader_version).
Multiple instances with the same key share every jar on disk.

1.8.9 arm64 macOS fix:
  The official Mojang LWJGL2 natives are x86_64 only. On Apple Silicon they crash.
  The fix (from https://github.com/GreeniusGenius/m1-prism-launcher-hack-1.8.9):
    - Download the vanilla version normally
    - Patch the natives dir with 3 ARM64 dylibs: liblwjgl.dylib, libopenal.dylib, libjcocoa.dylib
  We do this during install_vanilla_libraries() when lwjgl_override == "lwjgl2-arm64"
  AND mc_version is pre-1.13.
"""

import hashlib
import json
import os
import platform
import shutil
import zipfile
from pathlib import Path
from typing import Optional, Callable

import requests

import paths
from launcher.versions import get_version_manifest, get_fabric_profile_url, get_quilt_profile_url

# ── 1.8.9 / pre-1.13 arm64 natives from GreeniusGenius m1 hack ───────────────
# These are the exact dylibs needed for Minecraft ≤ 1.12 on Apple Silicon.
ARM64_189_BASE = (
    "https://github.com/GreeniusGenius/m1-prism-launcher-hack-1.8.9/raw/refs/heads/master/lwjglnatives"
)
ARM64_189_NATIVES = [
    "liblwjgl.dylib",
    "libopenal.dylib",
    "libjcocoa.dylib",
]

# ── LWJGL3 arm64 (for 1.13–1.19 range) ──────────────────────────────────────
LWJGL3_ARM64_VERSION = "3.3.1"


def _sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dest: Path, expected_sha1: Optional[str] = None,
               progress: Optional[Callable[[int, int], None]] = None):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and expected_sha1:
        if _sha1(dest) == expected_sha1:
            return  # cached and valid
    tmp = dest.with_suffix(".tmp")
    try:
        resp = requests.get(url, stream=True, timeout=60)
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length", 0))
        done  = 0
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(65536):
                f.write(chunk)
                done += len(chunk)
                if progress:
                    progress(done, total)
        if expected_sha1 and _sha1(tmp) != expected_sha1:
            tmp.unlink()
            raise RuntimeError(f"SHA1 mismatch for {url}")
        tmp.replace(dest)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def _get_system() -> tuple[str, str]:
    sys_os  = platform.system().lower()
    machine = platform.machine().lower()
    arch    = "arm64" if machine in ("arm64", "aarch64") else "x64"
    if sys_os == "darwin":
        return "osx", arch
    elif sys_os == "windows":
        return "windows", arch
    else:
        return "linux", arch


def _rule_matches(rules: list) -> bool:
    if not rules:
        return True
    result = False
    os_name, arch = _get_system()
    for rule in rules:
        action = rule.get("action") == "allow"
        if "os" in rule:
            rule_os = rule["os"]
            if "name" in rule_os and rule_os["name"] != os_name:
                continue
            if "arch" in rule_os:
                rule_arch = rule_os["arch"]
                # Mojang uses "x86" for 64-bit x86 natives on macOS
                if rule_arch == "x86" and arch == "arm64":
                    continue
        if "features" in rule:
            continue  # skip feature-gated rules (demo mode etc.)
        result = action
    return result


def _is_pre_113(mc_version: str) -> bool:
    """Return True for Minecraft versions before 1.13 (uses LWJGL2)."""
    try:
        parts = mc_version.split('.')
        major = int(parts[0]) if len(parts) > 0 else 0
        minor = int(parts[1]) if len(parts) > 1 else 0
        result = major < 1 or (major == 1 and minor < 13)
        print(f"DEBUG: Version {mc_version} -> major={major}, minor={minor}, pre-1.13={result}")
        return result
    except (ValueError, IndexError) as e:
        print(f"DEBUG: Failed to parse version {mc_version}: {e}")
        return False


# ─── Vanilla libraries ────────────────────────────────────────────────────────

def install_vanilla_libraries(
    mc_version: str,
    lwjgl_override: Optional[str] = None,
    progress_cb: Optional[Callable] = None,
) -> list[Path]:
    """
    Download all vanilla client libraries for mc_version.
    Returns list of jar paths that form the classpath.
    Handles arm64 macOS LWJGL patching automatically.
    """
    manifest = get_version_manifest(mc_version)
    os_name, arch = _get_system()
    jars: list[Path] = []
    libs = manifest.get("libraries", [])

    # Decide if we need arm64 native patching
    need_arm64_patch = (
        lwjgl_override == "lwjgl2-arm64"
        or (lwjgl_override == "" and os_name == "osx" and arch == "arm64" and _is_pre_113(mc_version))
    )

    for i, lib in enumerate(libs):
        if not _rule_matches(lib.get("rules", [])):
            if progress_cb:
                progress_cb(i + 1, len(libs))
            continue

        downloads = lib.get("downloads", {})
        lib_name  = lib.get("name", "")

        # Main artifact
        artifact = downloads.get("artifact")
        if artifact and artifact.get("url"):
            path_str = artifact["path"]
            dest     = paths.CLASSPATH_DIR / path_str
            _download(artifact["url"], dest, artifact.get("sha1"))
            jars.append(dest)

        # Classifiers (natives)
        classifiers = downloads.get("classifiers", {})
        if classifiers:
            # Determine classifier for this platform
            classifier_key = f"{os_name}-{arch}"
            if os_name == "osx":
                if arch == "arm64" and need_arm64_patch and lwjgl_override == "lwjgl2-arm64":
                    classifier_key = "natives-osx"  # Use our patched natives
                else:
                    classifier_key = "natives-osx"
            elif os_name == "windows":
                classifier_key = "natives-windows"
            elif os_name == "linux":
                classifier_key = "natives-linux"

            # Try platform-specific classifier first, then fallback
            for key in [classifier_key, f"natives-{os_name}"]:
                if key in classifiers:
                    native = classifiers[key]
                    if native.get("url"):
                        # Special handling for arm64 macOS LWJGL2 patching
                        if key == "natives-osx" and need_arm64_patch and lwjgl_override == "lwjgl2-arm64":
                            # For arm64 patching, we download normally then patch later in the native extraction
                            dest = paths.CLASSPATH_DIR / native["path"]
                        else:
                            dest = paths.CLASSPATH_DIR / native["path"]
                        _download(native["url"], dest, native.get("sha1"))
                        jars.append(dest)  # Include native jars in classpath for extraction
                    break

        if progress_cb:
            progress_cb(i + 1, len(libs))

    # For pre-1.13 versions, manually add launchwrapper if not present
    if _is_pre_113(mc_version):
        launchwrapper_found = any("launchwrapper" in str(j).lower() for j in jars)
        print(f"DEBUG: Pre-1.13 version {mc_version}, launchwrapper found: {launchwrapper_found}")
        
        if not launchwrapper_found:
            print(f"DEBUG: Launchwrapper not found for {mc_version}, adding manually")
            # Download launchwrapper manually
            launchwrapper_path = paths.CLASSPATH_DIR / "net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar"
            launchwrapper_path.parent.mkdir(parents=True, exist_ok=True)
            print(f"DEBUG: Launchwrapper target path: {launchwrapper_path}")
            
            if not launchwrapper_path.exists():
                print(f"DEBUG: Launchwrapper file doesn't exist, downloading...")
                launchwrapper_url = "https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar"
                try:
                    print(f"DEBUG: Attempting to download from: {launchwrapper_url}")
                    _download(launchwrapper_url, launchwrapper_path, None)
                    print(f"DEBUG: Downloaded launchwrapper to {launchwrapper_path}")
                    print(f"DEBUG: File exists after download: {launchwrapper_path.exists()}")
                    if launchwrapper_path.exists():
                        file_size = launchwrapper_path.stat().st_size
                        print(f"DEBUG: Launchwrapper file size: {file_size} bytes")
                except Exception as e:
                    print(f"DEBUG: Failed to download launchwrapper: {e}")
                    # Try alternative approach - use maven central
                    try:
                        alt_url = "https://repo1.maven.org/maven2/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar"
                        print(f"DEBUG: Trying alternative URL: {alt_url}")
                        _download(alt_url, launchwrapper_path, None)
                        print(f"DEBUG: Downloaded launchwrapper from maven central")
                    except Exception as e2:
                        print(f"DEBUG: Failed to download launchwrapper from maven central: {e2}")
            else:
                print(f"DEBUG: Launchwrapper file already exists: {launchwrapper_path}")
                file_size = launchwrapper_path.stat().st_size
                print(f"DEBUG: Existing launchwrapper file size: {file_size} bytes")
            
            if launchwrapper_path.exists():
                jars.append(launchwrapper_path)
                print(f"DEBUG: Added launchwrapper to classpath, total jars: {len(jars)}")
                print(f"DEBUG: Launchwrapper in final jars list: {launchwrapper_path in jars}")
            else:
                print(f"DEBUG: Launchwrapper file not found after download attempt")
        else:
            print(f"DEBUG: Launchwrapper already present in classpath")

    return jars


def patch_arm64_natives_189(mc_version: str, instance_id: str, progress_cb=None, natives_dir: Path = None):
    """
    Download and place the GreeniusGenius arm64 dylibs into the natives directory.
    This is the exact same approach as the working test script.
    Only called for pre-1.13 on arm64 macOS.
    """
    os_name, arch = _get_system()
    if not (os_name == "osx" and arch == "arm64"):
        return  # only needed on Apple Silicon

    print("[PATCH LWJGL] Starting Patch...")

    if natives_dir is None:
        natives_dir = paths.TEMP_DIR / "natives" / instance_id
    natives_dir.mkdir(parents=True, exist_ok=True)

    total = len(ARM64_189_NATIVES)
    print(f"[PATCH LWJGL] Found {total} natives to patch")
    for i, filename in enumerate(ARM64_189_NATIVES):
        url  = f"{ARM64_189_BASE}/{filename}"
        dest = natives_dir / filename
        print(f"[PATCH LWJGL] Downloading {filename}")
        _download(url, dest, progress=None)
        if progress_cb:
            progress_cb(i + 1, total)

    print("[PATCH LWJGL] Patching complete!")


def download_client_jar(mc_version: str, progress_cb=None) -> Path:
    """Download the vanilla client.jar to the shared MC versions dir."""
    manifest = get_version_manifest(mc_version)
    client   = manifest["downloads"]["client"]
    dest     = paths.mc_version_dir(mc_version) / f"{mc_version}.jar"
    _download(client["url"], dest, client.get("sha1"), progress_cb)
    return dest


def save_version_json(mc_version: str) -> Path:
    """Save the version JSON to disk."""
    manifest = get_version_manifest(mc_version)
    dest = paths.mc_version_dir(mc_version) / f"{mc_version}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w") as f:
        json.dump(manifest, f, indent=2)
    return dest


# ─── Assets ──────────────────────────────────────────────────────────────────

def install_assets(mc_version: str, progress_cb=None) -> str:
    """Download asset index and all asset objects. Returns asset index id."""
    manifest   = get_version_manifest(mc_version)
    asset_info = manifest["assetIndex"]
    index_id   = asset_info["id"]
    index_dir  = paths.ASSETS_DIR / "indexes"
    index_dir.mkdir(parents=True, exist_ok=True)
    index_path = index_dir / f"{index_id}.json"

    _download(asset_info["url"], index_path, asset_info.get("sha1"))

    with open(index_path) as f:
        index = json.load(f)

    objects     = index.get("objects", {})
    objects_dir = paths.ASSETS_DIR / "objects"
    total       = len(objects)

    for i, (name, info) in enumerate(objects.items()):
        h    = info["hash"]
        dest = objects_dir / h[:2] / h
        if not dest.exists():
            url = f"https://resources.download.minecraft.net/{h[:2]}/{h}"
            _download(url, dest)
        if progress_cb:
            progress_cb(i + 1, total)

    return index_id


# ─── Modloader profile installs ──────────────────────────────────────────────

def install_fabric_or_quilt_libs(
    loader: str,
    mc_version: str,
    loader_version: str,
    progress_cb=None,
) -> tuple[list[Path], str]:
    """Download Fabric/Quilt loader libs into shared_loader_dir."""
    shared_dir = paths.shared_loader_dir(mc_version, loader, loader_version)
    shared_dir.mkdir(parents=True, exist_ok=True)

    if loader == "fabric":
        profile_url = get_fabric_profile_url(mc_version, loader_version)
    else:
        profile_url = get_quilt_profile_url(mc_version, loader_version)

    resp = requests.get(profile_url, timeout=30)
    resp.raise_for_status()
    profile = resp.json()

    with open(shared_dir / "profile.json", "w") as f:
        json.dump(profile, f, indent=2)

    main_class = profile.get("mainClass", "")
    jars: list[Path] = []
    libs = profile.get("libraries", [])

    for i, lib in enumerate(libs):
        dl   = lib.get("downloads", {}).get("artifact", {})
        url  = dl.get("url") or _maven_url(lib["name"], "https://maven.fabricmc.net/")
        sha1 = dl.get("sha1")
        path = dl.get("path") or _maven_path(lib["name"])
        dest = shared_dir / "libs" / path
        _download(url, dest, sha1)
        jars.append(dest)
        if progress_cb:
            progress_cb(i + 1, len(libs))

    return jars, main_class

def install_forge_libs(mc_version: str, forge_version: str, java_path: str, progress_cb=None) -> tuple[list[Path], str]:
    from launcher.versions import get_forge_installer_url
    import subprocess
    shared_dir = paths.shared_loader_dir(mc_version, "forge", forge_version)
    shared_dir.mkdir(parents=True, exist_ok=True)
    installer_url  = get_forge_installer_url(mc_version, forge_version)
    installer_path = shared_dir / f"forge-installer.jar"
    _download(installer_url, installer_path, None, progress_cb)
    install_dir = shared_dir / "install"
    install_dir.mkdir(exist_ok=True)
    subprocess.run([java_path, "-jar", str(installer_path), "--installClient", str(install_dir)],
                   capture_output=True, text=True, timeout=300)
    jars = list(install_dir.rglob("*.jar"))
    main_class = "net.minecraft.launchwrapper.Launch"
    for vj in (install_dir / "versions").rglob("*.json") if (install_dir / "versions").exists() else []:
        try:
            with open(vj) as f:
                vdata = json.load(f)
            if mc := vdata.get("mainClass"):
                main_class = mc
        except Exception:
            pass
    return jars, main_class


def install_neoforge_libs(mc_version: str, neoforge_version: str, java_path: str, progress_cb=None) -> tuple[list[Path], str]:
    from launcher.versions import get_neoforge_installer_url
    import subprocess
    shared_dir = paths.shared_loader_dir(mc_version, "neoforge", neoforge_version)
    shared_dir.mkdir(parents=True, exist_ok=True)
    installer_url  = get_neoforge_installer_url(neoforge_version)
    installer_path = shared_dir / f"neoforge-installer.jar"
    _download(installer_url, installer_path, None, progress_cb)
    install_dir = shared_dir / "install"
    install_dir.mkdir(exist_ok=True)
    subprocess.run([java_path, "-jar", str(installer_path), "--installClient", str(install_dir)],
                   capture_output=True, text=True, timeout=300)
    jars = list(install_dir.rglob("*.jar"))
    return jars, "net.minecraft.launchwrapper.Launch"


# ─── Maven helpers ────────────────────────────────────────────────────────────

def _maven_path(name: str) -> str:
    parts = name.split(":")
    group, artifact, version = parts[0], parts[1], parts[2]
    group_path = group.replace(".", "/")
    return f"{group_path}/{artifact}/{version}/{artifact}-{version}.jar"


def _maven_url(name: str, base: str) -> str:
    return base.rstrip("/") + "/" + _maven_path(name)

"""
java/checker.py – find, validate, and select Java installs.

Minecraft version → minimum Java:
  < 1.17   →  Java 8
  1.17–1.20.4 → Java 17
  1.20.5+  →  Java 21

On arm64 macOS we prefer Azul Zulu builds since they ship native aarch64 JDKs
and have very good Minecraft compatibility (especially Zulu 8 for 1.8 on M-series).
"""

import json
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional

import paths


def _run(cmd: list[str]) -> tuple[int, str, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return r.returncode, r.stdout, r.stderr
    except Exception as e:
        return -1, "", str(e)


def get_java_info(java_path: str) -> dict:
    """Return info dict for a java executable, or mark invalid."""
    code, out, err = _run([java_path, "-version"])
    combined = out + err
    if code not in (0, 1) and not combined:
        return {"path": java_path, "version": "", "arch": "", "valid": False}

    # Parse version - handle multiple formats
    version = ""
    # Try different patterns for various Java distributions
    patterns = [
        r'"(\d+(?:\.\d+)*)"',           # Standard: "1.8.0_482"
        r'openjdk version "([^"]+)"',        # OpenJDK: openjdk version "1.8.0_482"
        r'version ([^\s]+)',               # Simple: version 1.8.0_482
        r'(\d+(?:\.\d+)*)',            # Fallback: 1.8.0_482
    ]
    
    for pattern in patterns:
        m = re.search(pattern, combined)
        if m:
            version = m.group(1)
            break

    # Determine major version
    if version.startswith("1."):
        major = int(version.split(".")[1])
    elif version:
        major = int(version.split(".")[0])
    else:
        major = 0

    # Parse arch (64-bit / aarch64 / amd64)
    arch = ""
    if "aarch64" in combined.lower() or "arm64" in combined.lower():
        arch = "arm64"
    elif "64-bit" in combined or "amd64" in combined or "x86_64" in combined:
        arch = "x64"
    elif "32-bit" in combined or "i386" in combined:
        arch = "x86"
    else:
        # Default guess from OS
        arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"

    return {
        "path":    java_path,
        "version": version,
        "major":   major,
        "arch":    arch,
        "valid":   major > 0,
    }


def find_java_installs() -> list[dict]:
    """Scan common locations for Java installs and return info dicts."""
    candidates: list[str] = []
    system = platform.system()

    # JAVA_HOME env
    if jh := os.environ.get("JAVA_HOME"):
        candidates.append(str(Path(jh) / "bin" / "java"))

    # PATH
    if which := shutil.which("java"):
        candidates.append(which)

    if system == "Darwin":
        # Homebrew / Zulu / etc. - search recursively
        for base in [
            "/Library/Java/JavaVirtualMachines",
            str(Path.home() / "Library/Java/JavaVirtualMachines"),
            str(Path.home() / "Library/Application Support/PrismLauncher/java"),
            "/opt/homebrew/opt",  # Homebrew on Apple Silicon
            "/usr/local/opt",     # Homebrew on Intel
        ]:
            bp = Path(base).expanduser()
            if bp.exists():
                print(f"Searching {bp} for Java...")
                # Recursively search for java executables
                for java_exe in bp.rglob("bin/java"):
                    if java_exe.exists() and java_exe.is_file():
                        candidates.append(str(java_exe))
                # Also check for JDK structure (Contents/Home/bin/java)
                for java_exe in bp.rglob("Contents/Home/bin/java"):
                    if java_exe.exists() and java_exe.is_file():
                        candidates.append(str(java_exe))
        # Bundled java in CraftLaunch data dir
        for j in paths.JAVA_DIR.rglob("bin/java"):
            candidates.append(str(j))

    elif system == "Windows":
        for base in [
            r"C:\Program Files\Java",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\Zulu",
            r"C:\Program Files\Microsoft",
        ]:
            bp = Path(base)
            if bp.exists():
                for jdk in bp.iterdir():
                    j = jdk / "bin" / "java.exe"
                    if j.exists():
                        candidates.append(str(j))
        for j in paths.JAVA_DIR.rglob("bin/java.exe"):
            candidates.append(str(j))

    seen: set[str] = set()
    results: list[dict] = []
    for c in candidates:
        real = str(Path(c).resolve())
        if real in seen:
            continue
        seen.add(real)
        info = get_java_info(c)
        if info["valid"]:
            results.append(info)

    return results


def required_java_major(mc_version: str) -> int:
    """Return the minimum Java major version required for a given MC version."""
    parts = mc_version.split(".")
    try:
        minor = int(parts[1]) if len(parts) > 1 else 0
        patch = int(parts[2]) if len(parts) > 2 else 0
    except ValueError:
        minor, patch = 0, 0

    if minor >= 21 or (minor == 20 and patch >= 5):
        return 21
    elif minor >= 17:
        return 17
    else:
        return 8


def pick_java(mc_version: str, preferred_path: Optional[str] = None,
              javas: Optional[list[dict]] = None) -> Optional[dict]:
    """
    Pick the best Java for the given MC version.
    Prefers arm64 on arm64 systems, meets the minimum required major version.
    """
    required = required_java_major(mc_version)
    sys_arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"

    if preferred_path:
        info = get_java_info(preferred_path)
        if info["valid"] and info.get("major", 0) >= required:
            return info

    all_javas = javas or find_java_installs()

    # Filter to valid + meets requirement
    valid = [j for j in all_javas if j.get("major", 0) >= required]

    # Prefer arch match
    arch_match = [j for j in valid if j.get("arch") == sys_arch]
    pool = arch_match or valid

    if not pool:
        return None

    # Among those, pick lowest major that meets requirement (most compatible)
    return min(pool, key=lambda j: j.get("major", 99))


def validate_for_instance(instance: dict, javas: Optional[list[dict]] = None) -> dict:
    """
    Returns {"valid": bool, "java": dict|None, "message": str}
    """
    mc_version = instance.get("minecraftVersion", "")
    preferred  = instance.get("javaPath")
    java       = pick_java(mc_version, preferred, javas)
    if java:
        return {"valid": True, "java": java, "message": ""}
    required = required_java_major(mc_version)
    return {
        "valid":   False,
        "java":    None,
        "message": f"No Java {required}+ found. Install Zulu JDK {required} from azul.com/downloads.",
    }

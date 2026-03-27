"""
launcher/launch.py – build and execute Minecraft launch commands.

Shared-library strategy (central design decision):
  All instances with the same (mc_version, loader, loader_version) share:
    - Vanilla client jar
    - Vanilla library jars
    - Modloader jars (in shared_loader_dir)
    - Asset objects

  Per-instance (not shared):
    - mods/ directory
    - config/, saves/, screenshots/, logs/

This module assembles the full classpath from shared dirs, then appends
instance-specific paths, and launches the JVM.
"""

import json
import os
import platform
import re
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional
from launcher.pre113_macos_arm import main as launch_pre113_macos_arm


import paths
from launcher.libraries import (
    install_vanilla_libraries,
    install_fabric_or_quilt_libs,
    install_forge_libs,
    install_neoforge_libs,
    download_client_jar,
    install_assets,
    save_version_json,
    patch_arm64_natives_189,
    _is_pre_113,
    _get_system,
)
from launcher.versions import get_version_manifest
from java.checker import pick_java, validate_for_instance

# Registry: instance_id → subprocess.Popen
_running: dict[str, subprocess.Popen] = {}
_lock = threading.Lock()


# ─── Public API ──────────────────────────────────────────────────────────────

# launcher/launch.py (only launch() shown)

def launch(
    instance: dict,
    user: dict,
    log_cb: Optional[Callable[[str, str, str], None]] = None,
    progress_cb: Optional[Callable[[str, int, int], None]] = None,
    window_ref=None,
) -> dict:
    instance_id = instance["id"]
    mc_version  = instance["minecraftVersion"]
    loader      = instance.get("modLoader", "vanilla")
    loader_ver  = instance.get("modLoaderVersion", "")
    lwjgl_ovr   = instance.get("lwjglOverride") or _auto_lwjgl(mc_version)
    ram         = instance.get("ram", 2048)
    extra_jvm   = instance.get("jvmArgs", "")

    # ── Token validation ─────────────────────────────────────────────────
    # Skip token validation for offline accounts
    account_type = user.get("accountType")
    is_offline = account_type == "offline" or account_type is None
    print(f"DEBUG: Launch - User accountType: {account_type}, is_offline: {is_offline}")
    
    if not is_offline:
        from auth.microsoft import validate_token, authenticate_from_refresh
        access_token = user.get("accessToken", "")
        if not validate_token(access_token):
            _log(log_cb, instance_id, "INFO", "Access token expired, refreshing…")
            try:
                new_data = authenticate_from_refresh(user["refreshToken"])
                user = {
                    **user,
                    "accessToken": new_data["accessToken"],
                    "refreshToken": new_data.get("refreshToken", user["refreshToken"]),
                }
            except Exception as e:
                return {"success": False, "pid": None, "error": f"Token refresh failed: {e}"}
        else:
            _log(log_cb, instance_id, "INFO", "Access token is valid")
    else:
        _log(log_cb, instance_id, "INFO", "Offline account - skipping token validation")

    # ── Java check ────────────────────────────────────────────────────────
    # Check if we need to use Java 8 for older Minecraft versions
    mc_version = instance.get("minecraftVersion", "")
    needs_java8 = _is_mc_version_older_or_equal(mc_version, "1.16.5")
    
    print(f"DEBUG: Minecraft version {mc_version}, needs Java 8: {needs_java8}")
    
    # Load default Java config if instance doesn't have javaPath
    instance_java_path = instance.get("javaPath")
    if not instance_java_path:
        try:
            import json
            import paths
            from java.checker import find_java_installs
            
            config_path = paths.ROOT / "java_config.json"
            default_java_path = None
            
            # Load default Java config
            if config_path.exists():
                with open(config_path, 'r') as f:
                    config = json.load(f)
                default_java_path = config.get("default_java_path")
                print(f"DEBUG: Default Java from config: {default_java_path}")
            
            # If we need Java 8, try to find it first
            if needs_java8:
                javas = find_java_installs()
                java8 = None
                for java in javas:
                    version = java.get("version", "")
                    if version.startswith("1.8."):
                        java8 = java
                        print(f"DEBUG: Found Java 8: {java['path']} - {version}")
                        break
                
                if java8:
                    instance_java_path = java8["path"]
                    print(f"DEBUG: Using Java 8 for Minecraft {mc_version}: {instance_java_path}")
                elif default_java_path:
                    instance_java_path = default_java_path
                    print(f"DEBUG: No Java 8 found, using default: {instance_java_path}")
                else:
                    print(f"DEBUG: No Java 8 or default found, will auto-detect")
            elif default_java_path:
                instance_java_path = default_java_path
                print(f"DEBUG: Using default Java for Minecraft {mc_version}: {instance_java_path}")
            else:
                print(f"DEBUG: No default Java set, will auto-detect")
                
            # Temporarily set javaPath on instance for validation
            if instance_java_path:
                instance["javaPath"] = instance_java_path
                
        except Exception as e:
            print(f"Failed to load Java configuration: {e}")
    
    java_result = validate_for_instance(instance)
    if not java_result["valid"]:
        return {"success": False, "pid": None, "error": java_result["message"]}
    java_info = java_result["java"]
    java_exe  = java_info["path"]
    _log(
        log_cb,
        instance_id,
        "INFO",
        f"Using Java {java_info['version']} ({java_info['arch']}) at {java_exe}",
    )

    # ── Special-case pre-1.13 on macOS ARM via minecraft_launcher_lib ────
    is_macos_arm = (
        platform.system() == "Darwin"
        and platform.machine().lower() in ("arm64", "aarch64")
    )
    is_pre113 = _is_pre_113(mc_version)
    
    print(f"DEBUG: Platform check - System: {platform.system()}, Machine: {platform.machine()}")
    print(f"DEBUG: macOS ARM: {is_macos_arm}, Pre-1.13: {is_pre113}, Version: {mc_version}")
    print(f"DEBUG: Should use pre113_macos_arm: {is_macos_arm and is_pre113}")
    
    if is_macos_arm and is_pre113:
        print("DEBUG: Using pre113_macos_arm launch path")
        from launcher.pre113_macos_arm import main as launch_pre113_macos_arm

        username = user.get("username") or "Player"
        uuid     = user.get("uuid", "")
        token    = user.get("accessToken", "")

        # Use parent of your version dir as MLL root so it has versions/<ver> layout
        mll_root = paths.mc_version_dir(mc_version).parent
        instance_root = paths.instance_dir(instance_id) # already used later as game_dir


        _log(
            log_cb,
            instance_id,
            "INFO",
            (
                f"Using minecraft_launcher_lib legacy path for {mc_version} on macOS ARM "
                f"(loader={loader}, loaderVersion={loader_ver})"
            ),
        )

        try:
            proc = launch_pre113_macos_arm(
                str(instance_root),
                java_exe,
                mc_version,
                username,
                uuid,
                token,
                loader=loader,
                loader_version=loader_ver,
            )
        except Exception as e:
            return {
                "success": False,
                "pid": None,
                "error": f"Legacy pre-1.13 launch failed: {e}",
            }

        with _lock:
            _running[instance_id] = proc

        threading.Thread(
            target=_stream_logs,
            args=(proc, instance_id, log_cb, window_ref),
            daemon=True,
        ).start()

        from launcher.instances import update_last_played
        update_last_played(instance_id)

        return {"success": True, "pid": proc.pid, "error": ""}

    # ── Normal path for everything else ──────────────────────────────────

    try:
        _log(log_cb, instance_id, "INFO", "Installing vanilla libraries…")
        vanilla_libs = install_vanilla_libraries(
            mc_version,
            lwjgl_ovr,
            lambda d, t: _prog(progress_cb, "libraries", d, t),
        )

        _log(log_cb, instance_id, "INFO", "Downloading client jar…")
        client_jar = download_client_jar(
            mc_version,
            lambda d, t: _prog(progress_cb, "client", d, t),
        )

        _log(log_cb, instance_id, "INFO", "Installing assets…")
        asset_index = install_assets(
            mc_version,
            lambda d, t: _prog(progress_cb, "assets", d, t),
        )

        save_version_json(mc_version)

        loader_jars: list[Path] = []
        main_class = _vanilla_main_class(mc_version)

        if loader in ("fabric", "quilt"):
            _log(log_cb, instance_id, "INFO", f"Installing {loader} {loader_ver}…")
            loader_jars, main_class = install_fabric_or_quilt_libs(
                loader,
                mc_version,
                loader_ver,
                lambda d, t: _prog(progress_cb, "loader", d, t),
            )
        elif loader == "forge":
            _log(log_cb, instance_id, "INFO", f"Installing Forge {loader_ver}…")
            loader_jars, main_class = install_forge_libs(
                mc_version,
                loader_ver,
                java_exe,
                lambda d, t: _prog(progress_cb, "loader", d, t),
            )
        elif loader == "neoforge":
            _log(log_cb, instance_id, "INFO", f"Installing NeoForge {loader_ver}…")
            loader_jars, main_class = install_neoforge_libs(
                mc_version,
                loader_ver,
                java_exe,
                lambda d, t: _prog(progress_cb, "loader", d, t),
            )

    except Exception as e:
        return {"success": False, "pid": None, "error": f"Install failed: {e}"}

    classpath = _build_classpath(vanilla_libs, loader_jars, client_jar)

    game_dir    = paths.instance_dir(instance_id)
    natives_dir = _extract_natives(mc_version, vanilla_libs, instance_id, lwjgl_ovr)

    if _is_pre_113(mc_version):
        print("patching natives")
        patch_arm64_natives_189(mc_version, instance_id, natives_dir=natives_dir)
        # your existing native-filtering logic here (if you keep it)

    manifest  = get_version_manifest(mc_version)
    jvm_args  = _build_jvm_args(
        manifest, java_info, ram, natives_dir, extra_jvm, lwjgl_ovr
    )
    game_args = _build_game_args(
        manifest, user, game_dir, asset_index, mc_version, loader, loader_ver
    )

    cmd = [java_exe] + jvm_args + ["-cp", classpath, main_class] + game_args
    _log(
        log_cb,
        instance_id,
        "DEBUG",
        "Launch command: " + " ".join(str(c) for c in cmd),
    )
    
    # Additional debug info for troubleshooting
    print(f"DEBUG: Launch command details:")
    print(f"  Java executable: {java_exe}")
    print(f"  Main class: {main_class}")
    print(f"  Classpath entries: {len(classpath.split(':'))}")
    print(f"  JVM arguments: {len(jvm_args)}")
    print(f"  Game arguments: {len(game_args)}")
    print(f"  Total command parts: {len(cmd)}")

    try:
        env = {**os.environ, "JAVA_HOME": str(Path(java_exe).parent.parent)}
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(game_dir),
            env=env,
            text=True,
            bufsize=1,
        )
        with _lock:
            _running[instance_id] = proc

        threading.Thread(
            target=_stream_logs,
            args=(proc, instance_id, log_cb, window_ref),
            daemon=True,
        ).start()

        from launcher.instances import update_last_played
        update_last_played(instance_id)

        return {"success": True, "pid": proc.pid, "error": ""}

    except Exception as e:
        return {"success": False, "pid": None, "error": str(e)}



def kill(instance_id: str):
    """Force-kill a running instance."""
    with _lock:
        proc = _running.get(instance_id)
    if proc and proc.poll() is None:
        proc.kill()
        proc.wait()
    with _lock:
        _running.pop(instance_id, None)


def get_running() -> list[str]:
    """Return list of currently running instance IDs."""
    with _lock:
        dead = [iid for iid, p in _running.items() if p.poll() is not None]
        for iid in dead:
            del _running[iid]
        return list(_running.keys())


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _vanilla_main_class(mc_version: str) -> str:
    try:
        manifest = get_version_manifest(mc_version)
        main_class = manifest.get("mainClass", "net.minecraft.client.main.Main")
        print(f"DEBUG: Version {mc_version} main class from manifest: '{main_class}'")
        
        # For versions before 1.13, they use launchwrapper
        if _is_mc_version_older_or_equal(mc_version, "1.12.2"):
            expected_main = "net.minecraft.launchwrapper.Launch"
            if main_class != expected_main:
                print(f"DEBUG: Overriding main class for {mc_version} from '{main_class}' to '{expected_main}'")
                return expected_main
        
        return main_class
    except Exception as e:
        print(f"DEBUG: Error getting main class for {mc_version}: {e}")
        return "net.minecraft.client.main.Main"


def _build_classpath(vanilla_libs: list, loader_jars: list, client_jar: Path) -> str:
    sep = ";" if platform.system() == "Windows" else ":"
    
    print(f"DEBUG: Building classpath with {len(vanilla_libs)} vanilla libs, {len(loader_jars)} loader jars")
    print(f"DEBUG: Vanilla libs: {[lib.name for lib in vanilla_libs]}")
    print(f"DEBUG: Loader jars: {[lib.name for lib in loader_jars]}")
    
    # Extract library names without versions for conflict detection
    def get_lib_name(jar_path: Path) -> str:
        name = jar_path.name.lower()
        # Remove version numbers (e.g., asm-9.6.jar -> asm, guava-31.1.jar -> guava)
        import re
        name = re.sub(r'-\d+(\.\d+)*\.jar$', '.jar', name)
        for suffix in ['.jar', '-sources.jar']:
            name = name.replace(suffix, '')
        # Split by last dash to separate name from version
        parts = name.split('-')
        if len(parts) > 1 and parts[-1].replace('.', '').isdigit():
            return '-'.join(parts[:-1])  # Return name without version
        return name  # Return full name if no version detected
    
    # Build library groups by base name
    lib_groups: dict[str, dict] = {}  # name -> {"vanilla": [], "loader": []}
    
    # Group vanilla libraries
    for jar in vanilla_libs:
        lib_name = get_lib_name(Path(jar))
        if lib_name not in lib_groups:
            lib_groups[lib_name] = {"vanilla": [], "loader": []}
        lib_groups[lib_name]["vanilla"].append(Path(jar))
    
    # Group loader libraries
    for jar in loader_jars:
        lib_name = get_lib_name(Path(jar))
        if lib_name not in lib_groups:
            lib_groups[lib_name] = {"vanilla": [], "loader": []}
        lib_groups[lib_name]["loader"].append(Path(jar))
    
    # Build final classpath: prefer vanilla libs, add loader libs only if no vanilla conflict
    final_jars: list[Path] = []
    for lib_name, groups in lib_groups.items():
        if groups["vanilla"]:
            # Use vanilla libraries (they're compatible with Minecraft)
            final_jars.extend(groups["vanilla"])
        else:
            # Use loader libraries only if no vanilla version exists
            final_jars.extend(groups["loader"])
    
    # Always add client jar
    final_jars.append(client_jar)
    
    classpath_str = sep.join(str(j) for j in final_jars)
    print(f"DEBUG: Final classpath has {len(final_jars)} jars")
    print(f"DEBUG: Final classpath (first 200 chars): {classpath_str[:200]}...")
    
    # Check if launchwrapper is in classpath for older versions
    has_launchwrapper = any("launchwrapper" in str(j).lower() for j in final_jars)
    print(f"DEBUG: Launchwrapper in classpath: {has_launchwrapper}")
    
    return classpath_str


def _extract_natives(mc_version: str, vanilla_libs: list[Path],
                     instance_id: str, lwjgl_override: str) -> Path:
    """Extract native jars into a per-instance temp natives dir."""
    import zipfile
    natives_dir = paths.TEMP_DIR / "natives" / instance_id
    natives_dir.mkdir(parents=True, exist_ok=True)

    for jar in vanilla_libs:
        name = jar.name.lower()
        if "natives" in name or "native" in name:
            try:
                with zipfile.ZipFile(jar) as zf:
                    for member in zf.namelist():
                        if not member.endswith("/") and "/" not in member:
                            zf.extract(member, natives_dir)
            except Exception:
                pass

    return natives_dir


def _is_unsupported_jvm_flag(flag: str) -> bool:
    """Check if a JVM flag is unsupported in older Java versions."""
    unsupported_flags = [
        "--sun-misc-unsafe-memory-access=allow",
        "--add-modules",  # Some module flags may not be supported
    ]
    
    # Check exact matches
    if flag in unsupported_flags:
        return True
    
    # Check prefixes for flags with values
    for unsupported in unsupported_flags:
        if unsupported.endswith("=") and flag.startswith(unsupported):
            return True
    
    return False


def _is_mc_version_older_or_equal(mc_version: str, target_version: str) -> bool:
    """Compare Minecraft versions to check if mc_version <= target_version."""
    try:
        def version_tuple(v):
            # Split version and convert to integers for comparison
            parts = v.split('.')
            return tuple(int(p) for p in parts[:3])  # Only use first 3 parts
        
        mc_tuple = version_tuple(mc_version)
        target_tuple = version_tuple(target_version)
        
        return mc_tuple <= target_tuple
    except (ValueError, IndexError):
        # If version parsing fails, assume it's newer (don't force Java 8)
        return False


def _auto_lwjgl(mc_version: str) -> str:
    """
    Automatically select LWJGL override for arm64 macOS.
    - Pre-1.13 (uses LWJGL 2): return 'lwjgl2-arm64'
    - 1.13–1.19 (LWJGL 3 < 3.3.1): return 'lwjgl3-arm64'
    - 1.20+ ships arm64 natively: return ''
    """
    if platform.system() != "Darwin":
        return ""
    if platform.machine().lower() not in ("arm64", "aarch64"):
        return ""

    parts = mc_version.split(".")
    try:
        minor = int(parts[1]) if len(parts) > 1 else 0
        patch = int(parts[2]) if len(parts) > 2 else 0
    except ValueError:
        return ""

    if minor < 13:
        return "lwjgl2-arm64"
    if minor < 20:
        return "lwjgl3-arm64"
    return ""


def _build_jvm_args(
    manifest: dict,
    java_info: dict,
    ram: int,
    natives_dir: Path,
    extra: str,
    lwjgl_override: str,
) -> list[str]:
    args = [
        f"-Xms512m",
        f"-Xmx{ram}m",
        f"-Djava.library.path={natives_dir}",
        "-Dfile.encoding=UTF-8",
        "-Dminecraft.launcher.brand=CraftLaunch",
        "-Dminecraft.launcher.version=1.0.0",
        "-XX:+UseG1GC",
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:G1NewSizePercent=20",
        "-XX:G1ReservePercent=20",
        "-XX:MaxGCPauseMillis=50",
        "-XX:G1HeapRegionSize=32M",
        "-XX:ErrorFile=/Users/kokodev/Downloads/err.txt",
        "-XX:+UnlockDiagnosticVMOptions",
    ]

    # macOS arm64 LWJGL2 needs AWT headless workaround
    if lwjgl_override == "lwjgl2-arm64":
        args += [
            "-XstartOnFirstThread",
            "-Dorg.lwjgl.util.Debug=true",
            "-Dorg.lwjgl.input.Mouse.allowNegativeAbsolutePosition=true",
            "-XX:ErrorFile=/Users/kokodev/Downloads/err.txt"
        ]
    elif platform.system() == "Darwin":
        # LWJGL3 on macOS requires XstartOnFirstThread
        args.append("-XstartOnFirstThread")

    # Parse JVM args from version manifest
    manifest_jvm = manifest.get("arguments", {}).get("jvm", [])
    for arg in manifest_jvm:
        if isinstance(arg, str):
            # Filter out unsupported JVM flags
            if not _is_unsupported_jvm_flag(arg):
                args.append(arg)
            else:
                print(f"DEBUG: Filtering unsupported JVM flag: {arg}")
        elif isinstance(arg, dict):
            if _rule_matches(arg.get("rules", [])):
                val = arg.get("value", [])
                if isinstance(val, list):
                    # Filter each value in the list
                    filtered_val = [v for v in val if not _is_unsupported_jvm_flag(v)]
                    args.extend(filtered_val)
                else:
                    # Filter single value
                    if not _is_unsupported_jvm_flag(val):
                        args.append(val)
                    else:
                        print(f"DEBUG: Filtering unsupported JVM flag: {val}")

    # Legacy format
    if not manifest_jvm and "minecraftArguments" in manifest:
        pass  # legacy format has no jvm args section

    if extra:
        args.extend(extra.split())

    return args


def _build_game_args(
    manifest: dict,
    user: dict,
    game_dir: Path,
    asset_index: str,
    mc_version: str,
    loader: str,
    loader_ver: str,
) -> list[str]:
    # Debug user object contents
    print("User object:", user)
    username = user.get("username") or ""
    print(f"DEBUG: Retrieved username from user object: '{username}'")
    if not username:
        # Fallback to UUID-based username if username is missing
        uuid = user.get("uuid", "")
        username = f"Player_{uuid[:8]}" if uuid else "Player"
        print(f"DEBUG: Using fallback username: '{username}'")
    print("Final username:", username)
    
    # Check if this is an offline account
    account_type = user.get("accountType")
    is_offline = account_type == "offline" or account_type is None
    print(f"DEBUG: Game args - User accountType: {account_type}, is_offline: {is_offline}")
    
    replacements = {
        "${auth_player_name}":  username,
        "${version_name}":      mc_version,
        "${game_directory}":    str(game_dir),
        "${assets_dir}":        str(paths.ASSETS_DIR),
        "${assets_root}":       str(paths.ASSETS_DIR),
        "${game_assets}":       str(paths.ASSETS_DIR / "virtual" / "legacy"),
        "${assets_index_name}": asset_index,
        "${auth_uuid}":         user.get("uuid", "00000000-0000-0000-0000-000000000000"),
        "${auth_access_token}": user.get("accessToken", "0"),
        "${user_type}":         "offline" if is_offline else "msa",
        "${version_type}":      "release",
        "${user_properties}":   "{}",
        "${clientid}":          "CraftLaunch",
        "${auth_xuid}":         "0",
    }

    args: list[str] = []

    # Add --offline flag for offline accounts
    if is_offline:
        args.append("--offline")

    # New-style arguments
    game_args = manifest.get("arguments", {}).get("game", [])
    if game_args:
        for arg in game_args:
            if isinstance(arg, str):
                processed_arg = _sub(arg, replacements)
                # Filter out quick play and demo arguments
                if not (processed_arg.startswith("--quickPlay") or processed_arg.startswith("--demo")):
                    args.append(processed_arg)
            elif isinstance(arg, dict):
                if _rule_matches(arg.get("rules", [])):
                    val = arg.get("value", [])
                    if isinstance(val, list):
                        for v in val:
                            processed_v = _sub(v, replacements)
                            # Filter out quick play and demo arguments
                            if not (processed_v.startswith("--quickPlay") or processed_v.startswith("--demo")):
                                args.append(processed_v)
                    else:
                        processed_val = _sub(val, replacements)
                        # Filter out quick play and demo arguments
                        if not (processed_val.startswith("--quickPlay") or processed_val.startswith("--demo")):
                            args.append(processed_val)
    else:
        # Legacy minecraftArguments string
        legacy = manifest.get("minecraftArguments", "")
        for part in legacy.split():
            processed_part = _sub(part, replacements)
            # Filter out quick play and demo arguments
            if not (processed_part.startswith("--quickPlay") or processed_part.startswith("--demo")):
                args.append(processed_part)

    return args


def _sub(template: str, subs: dict) -> str:
    for k, v in subs.items():
        template = template.replace(k, str(v))
    return template


def _rule_matches(rules: list) -> bool:
    if not rules:
        return True
    result = False
    os_name = {"darwin": "osx", "windows": "windows", "linux": "linux"}.get(
        platform.system().lower(), "linux"
    )
    for rule in rules:
        action = rule.get("action") == "allow"
        if "os" in rule:
            if rule["os"].get("name", os_name) != os_name:
                continue
        result = action
    return result


def _stream_logs(proc: subprocess.Popen, instance_id: str, cb, window_ref=None):
    for line in iter(proc.stdout.readline, ""):
        line = line.rstrip()
        if not line:
            continue
        level = "INFO"
        if "[ERROR]" in line or "ERROR" in line:
            level = "ERROR"
        elif "[WARN]" in line or "WARN" in line:
            level = "WARN"
        elif "[DEBUG]" in line:
            level = "DEBUG"
        _log(cb, instance_id, level, line)

    # Process ended
    proc.wait()
    with _lock:
        _running.pop(instance_id, None)
    _log(cb, instance_id, "INFO", f"[Minecraft exited with code {proc.returncode}]")
    
    # Notify frontend of state change
    if window_ref:
        try:
            window_ref.evaluate_js(
                f"window.__craftlaunch_state_changed && window.__craftlaunch_state_changed()"
            )
        except Exception:
            pass


def _log(cb, instance_id: str, level: str, message: str):
    if cb:
        cb(instance_id, level, message)


def _prog(cb, stage: str, done: int, total: int):
    if cb:
        cb(stage, done, total)

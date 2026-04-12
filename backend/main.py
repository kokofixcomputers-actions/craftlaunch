"""
main.py – CraftLaunch entry point.

Usage:
    python main.py           # production (loads web/ build)
    python main.py --dev     # dev mode (loads http://localhost:5173)
"""

import sys
import os
import signal
import platform
from pathlib import Path
try:
    from pythonnet import set_runtime
    set_runtime("netfx")
    
    base_dir = Path(__file__).resolve().parent
    pydll = base_dir / "python311.dll"   # change if you're on 3.11/3.12 etc.
    
    if pydll.exists():
        os.environ["PYTHONNET_PYDLL"] = str(pydll)
        os.environ["BASE_DIR"] = str(base_dir)
except:
    pass

import webview
import paths
from api import LauncherAPI

DEV_URL  = "http://localhost:5173"
PROD_DIR = Path(__file__).parent / "web"


def main():
    dev_mode = False

    # Ensure all data directories exist
    paths.ensure_dirs()

    # Mutable list so API can hold a reference before window is created
    window_ref: list = []
    api = LauncherAPI(window_ref)

    # Add shutdown handler
    shutdown_completed = False
    
    def perform_shutdown():
        nonlocal shutdown_completed
        if shutdown_completed:
            return  # Prevent multiple shutdowns
        
        print("[DEBUG] Performing shutdown...")
        shutdown_completed = True
        
        try:
            # Call API shutdown to save any pending data
            api.shutdown()
            print("[DEBUG] Shutdown completed successfully")
        except Exception as e:
            print(f"[DEBUG] Shutdown error: {e}")

    if dev_mode:
        url = DEV_URL
    else:
        # Serve from built frontend
        if not (PROD_DIR / "index.html").exists():
            print("ERROR: web/ build not found. Run 'npm run build' in frontend/ first.")
            sys.exit(1)
        url = str(PROD_DIR / "index.html")

    # Window title bar managed by our React Titlebar component
    window = webview.create_window(
        title="CraftLaunch",
        url=url,
        js_api=api,
        width=1100,
        height=720,
        min_size=(800, 580),
        frameless=True,          # Custom title bar from React
        easy_drag=False,         # We handle drag in CSS
        background_color="#0e0f14",
        confirm_close=True,      # Enable closing event handling
    )

    window_ref.append(window)

    # Add closing event handler
    def on_closing():
        print("[DEBUG] Window closing event triggered (e.g., from Cmd+Q)")
        perform_shutdown()
        return True  # Allow closing after shutdown

    window.events.closing += on_closing

    # Platform-specific webview settings
    gui = None
    if platform.system() == "Darwin":
        gui = "cocoa"
    elif platform.system() == "Windows":
        gui = "edgechromium"

    # Start webview
    webview.start(
        debug=dev_mode,
        gui=gui,
    )
    
    # This runs after webview closes naturally (if closing event wasn't triggered)
    if not shutdown_completed:
        print("[DEBUG] Webview closed without event, performing shutdown...")
        perform_shutdown()


if __name__ == "__main__":
    main()

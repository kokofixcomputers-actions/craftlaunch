"""
main.py – CraftLaunch entry point.

Usage:
    python main.py           # production (loads web/ build)
    python main.py --dev     # dev mode (loads http://localhost:5173)
"""

import sys
import os
import platform
from pathlib import Path

# Ensure the backend directory is in the Python path
sys.path.insert(0, str(Path(__file__).parent))

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
        confirm_close=False,
    )

    window_ref.append(window)

    # Platform-specific webview settings
    gui = None
    if platform.system() == "Darwin":
        gui = "cocoa"
    elif platform.system() == "Windows":
        gui = "edgechromium"

    webview.start(
        debug=dev_mode,
        gui=gui,
    )


if __name__ == "__main__":
    main()

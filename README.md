# CraftLaunch

A feature-rich Minecraft launcher built with Python (pywebview) + React + TypeScript.

## Features

- **Microsoft login** (full MS → Xbox Live → XSTS → Minecraft OAuth chain)
- **Multi-instance** – run multiple games simultaneously
- **Shared libraries** – instances with the same MC version + modloader share downloaded jars (saves GBs of disk space)
- **Mod loaders** – Fabric, Forge, NeoForge, Quilt, Vanilla
- **Modrinth mod browser** – search, filter by MC version + loader, version picker, install/uninstall/toggle
- **Multi-user** – add/switch between multiple Microsoft accounts
- **Java auto-detection** – selects the right Java (8/17/21) per MC version, prefers arm64 on Apple Silicon
- **arm64 macOS support** – LWJGL2-arm64 patch for pre-1.13 on Apple Silicon (M1/M2/M3), auto-detected
- **Log window** – live game output streamed from subprocess
- **Force kill** – kill any running Minecraft instance from the launcher
- **Libraries tab** – change MC version, modloader, modloader version, LWJGL override per instance (experimental)

---

## Requirements

| Tool | Version |
|------|---------|
| Python | 3.10+ |
| pip | any recent |
| Node.js | 18+ |
| npm | 8+ |

**macOS arm64 (Apple Silicon):** Also install Zulu JDK 8 arm64 for Minecraft ≤ 1.16, Zulu JDK 17 for 1.17–1.20.4, Zulu JDK 21 for 1.20.5+. Download from [azul.com/downloads](https://www.azul.com/downloads/?package=jdk#zulu).

---

## Setup

### macOS / Linux
```bash
chmod +x setup.sh
./setup.sh
python3 backend/main.py
```

### Windows
```bat
setup.bat
python backend\main.py
```

### Dev mode (hot reload)
```bash
# Terminal 1 – Vite dev server
cd frontend && npm run dev

# Terminal 2 – pywebview pointing at localhost:5173
python3 backend/main.py --dev
```

---

## Azure App Registration

To use real Microsoft login you need an Azure App Registration:

1. Go to [portal.azure.com](https://portal.azure.com) → Azure Active Directory → App registrations → New registration
2. Name: `CraftLaunch` (or anything)
3. Supported account types: **Personal Microsoft accounts only**
4. Redirect URI: `https://login.live.com/oauth20_desktop.srf`
5. After creating, copy the **Application (client) ID**
6. Open `backend/auth/microsoft.py` and replace:
   ```python
   CLIENT_ID = "00000000-0000-0000-0000-000000000000"  # ← paste your ID here
   ```

The launcher uses the **public client flow** (no secret needed).

---

## Directory Layout

```
CraftLaunch data dir:
  macOS:   ~/Library/Application Support/CraftLaunch/
  Windows: %APPDATA%\CraftLaunch\
  Linux:   ~/.craftlaunch/

├── instances/
│   └── <instance-id>/
│       ├── instance.json   ← metadata
│       ├── mods/           ← instance-specific mod jars
│       ├── config/
│       ├── saves/
│       └── logs/
│
└── libraries/
    ├── minecraft/<version>/        ← vanilla client jar + JSON
    ├── shared/<mc>/<loader>/<ver>/ ← modloader jars (SHARED)
    ├── assets/                     ← asset index + objects (shared)
    ├── classpath/<maven-path>/     ← vanilla library jars (shared)
    └── lwjgl/<variant>/            ← LWJGL arm64 overrides
```

**Shared library key:** `minecraft_version / modloader / modloader_version`

All instances with the same key share all jars. Only `mods/`, `config/`, `saves/`, `screenshots/`, `resourcepacks/` are per-instance. This design means:
- Two Fabric 0.15.11 + MC 1.20.1 instances → one copy of Fabric jars
- A third instance changes its loader version → downloads once, shares with any future instances that match

---

## arm64 macOS (Apple Silicon) — LWJGL Notes

| MC Version | LWJGL | Action |
|-----------|-------|--------|
| ≤ 1.12.2 | LWJGL 2.x | Downloads `lwjgl2-arm64` community build (r58Playz/lwjgl2-m1) |
| 1.13–1.19 | LWJGL 3.x (< 3.3.1) | Patches to LWJGL 3.3.1 arm64 natives |
| 1.20+ | LWJGL 3.3.1+ | Mojang ships arm64 natively, no patch needed |

The auto-detect logic in `launcher/launch.py → _auto_lwjgl()` handles this automatically. You can also override per-instance in the **Libraries** tab.

---

## Project Structure

```
minecraft-launcher/
├── backend/
│   ├── main.py           ← pywebview entry point
│   ├── api.py            ← JS API bridge (all pywebview.api.* methods)
│   ├── paths.py          ← directory layout constants
│   ├── auth/
│   │   └── microsoft.py  ← full OAuth → Minecraft auth chain
│   ├── launcher/
│   │   ├── versions.py   ← Mojang/Fabric/Forge/NeoForge/Quilt version fetchers
│   │   ├── libraries.py  ← shared library downloader, LWJGL patcher
│   │   ├── instances.py  ← instance CRUD (instance.json)
│   │   └── launch.py     ← classpath builder, JVM arg builder, process spawner
│   ├── java/
│   │   └── checker.py    ← Java finder, version validator
│   └── mods/
│       └── modrinth.py   ← Modrinth search, download, toggle
│
└── frontend/
    └── src/
        ├── api/bridge.ts           ← pywebview API wrapper + dev mocks
        ├── store/index.ts          ← Zustand global state
        ├── components/
        │   ├── Titlebar.tsx
        │   ├── Sidebar.tsx
        │   ├── OnboardingModal.tsx
        │   ├── CreateInstanceModal.tsx
        │   └── LogViewer.tsx
        └── pages/
            ├── HomePage.tsx
            ├── InstancesPage.tsx
            ├── InstanceDetailPage.tsx  ← Overview / Mods / Libraries / Settings tabs
            ├── ModsPage.tsx
            └── SettingsPage.tsx
```

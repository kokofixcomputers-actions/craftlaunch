"""
auth/microsoft.py – Microsoft OAuth with localhost:8080/callback.

Bug fix: the old code called server.shutdown() from the main thread while
the serve loop was blocked inside handle_request(), causing a deadlock that
left the frontend stuck on "Waiting for you to sign in…".

Fix: use socketserver.TCPServer directly with allow_reuse_address, run
serve_forever() in the background thread, and call server.shutdown() only
from the MAIN thread (which is what serve_forever() is designed for).
serve_forever() / shutdown() use an internal pipe pair specifically to avoid
the blocking-handle_request deadlock.
"""

import platform
import secrets
import socket
import subprocess
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import requests

# ── Azure config ───────────────────────────────────────────────────────────────
CLIENT_ID     = "e58ef09d-2e77-4bdc-9925-040ee6a99e76"  # ← your Azure client ID
REDIRECT_URI  = "http://localhost:8080/callback"        # must match Azure portal exactly
SCOPE         = "XboxLive.signin offline_access"
CALLBACK_PORT = 8080
LOGIN_TIMEOUT = 300  # seconds before giving up

# ── Endpoints ─────────────────────────────────────────────────────────────────
MS_AUTH_URL    = "https://login.live.com/oauth20_authorize.srf"
MS_TOKEN_URL   = "https://login.live.com/oauth20_token.srf"
XBL_AUTH_URL   = "https://user.auth.xboxlive.com/user/authenticate"
XSTS_AUTH_URL  = "https://xsts.auth.xboxlive.com/xsts/authorize"
MC_AUTH_URL    = "https://api.minecraftservices.com/authentication/login_with_xbox"
MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile"

# ── HTML pages served back to the browser ─────────────────────────────────────
_SUCCESS_HTML = b"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>CraftLaunch \xe2\x80\x93 Signed In</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0e0f14;color:#f0f2f8;
display:flex;align-items:center;justify-content:center;height:100vh}
.c{text-align:center;padding:2.5rem 3rem;background:rgba(255,255,255,.06);
border-radius:1.25rem;border:1px solid rgba(255,255,255,.1)}
h2{margin-bottom:.5rem;color:#4ade80;font-size:1.3rem}
p{color:#9aa0b8;font-size:.9rem}</style>
<script>setTimeout(()=>window.close(),2500)</script>
</head><body><div class="c">
<h2>&#10003; Signed in successfully</h2>
<p>You can close this tab \xe2\x80\x94 CraftLaunch is continuing automatically.</p>
</div></body></html>"""

_ERROR_TMPL = """<!DOCTYPE html><html><head><meta charset="utf-8">
<title>CraftLaunch \u2013 Error</title>
<style>*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:system-ui,sans-serif;background:#0e0f14;color:#f0f2f8;
display:flex;align-items:center;justify-content:center;height:100vh}}
.c{{text-align:center;padding:2.5rem 3rem;background:rgba(255,255,255,.06);
border-radius:1.25rem;border:1px solid rgba(239,68,68,.3)}}
h2{{margin-bottom:.5rem;color:#f87171;font-size:1.3rem}}
p{{color:#9aa0b8;font-size:.9rem}}</style>
</head><body><div class="c">
<h2>Login failed</h2><p>{error}</p>
</div></body></html>"""


# ── Callback handler ───────────────────────────────────────────────────────────

class _Handler(BaseHTTPRequestHandler):
    """Handles exactly one GET /callback?code=... then signals the main thread."""

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path != "/callback":
            self._send(404, b"text/plain", b"Not found")
            return

        params = parse_qs(parsed.query)

        if "error" in params:
            desc = params.get("error_description", params["error"])[0]
            self._send(400, b"text/html", _ERROR_TMPL.format(error=desc).encode())
            self.server.auth_result = {"error": desc}

        elif "code" in params:
            given_state    = params.get("state", [""])[0]
            expected_state = getattr(self.server, "expected_state", "")

            if given_state != expected_state:
                msg = "State mismatch \u2014 possible CSRF. Please try again."
                self._send(400, b"text/html", _ERROR_TMPL.format(error=msg).encode())
                self.server.auth_result = {"error": msg}
            else:
                self._send(200, b"text/html", _SUCCESS_HTML)
                self.server.auth_result = {"code": params["code"][0]}
        else:
            msg = "No authorization code received."
            self._send(400, b"text/html", _ERROR_TMPL.format(error=msg).encode())
            self.server.auth_result = {"error": msg}

        # Signal the main thread that we have a result, THEN let
        # serve_forever() be shut down from the main thread.
        self.server.got_result.set()

    def _send(self, status: int, ctype: bytes, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", ctype.decode())
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass  # silence request log


# ── Port helper ────────────────────────────────────────────────────────────────

def _pick_port(preferred: int) -> int:
    for port in (preferred, 0):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
        except OSError:
            continue
    raise RuntimeError("Could not bind any port for OAuth callback")


# ── Browser opener ─────────────────────────────────────────────────────────────

def _open_browser(url: str):
    """Open URL in the default system browser from Python (no pywebview)."""
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(["open", url])
        elif system == "Windows":
            subprocess.Popen(f'start "" "{url}"', shell=True)
        else:
            subprocess.Popen(["xdg-open", url])
    except Exception:
        webbrowser.open(url)


# ── Main public function ───────────────────────────────────────────────────────

def start_login_flow(progress_cb=None) -> dict:
    """
    Fully automated Microsoft → Minecraft login.

    1. Starts HTTPServer.serve_forever() in a daemon thread
    2. Opens the system browser (Python subprocess, not pywebview)
    3. Waits for got_result event (set by the handler after writing the response)
    4. Calls server.shutdown() from THIS thread — the only safe way with serve_forever()
    5. Exchanges code, runs Xbox/XSTS/Minecraft chain
    6. Returns User dict

    Raises RuntimeError on timeout or any auth failure.
    """
    def p(msg: str):
        if progress_cb:
            progress_cb(msg)

    # 1. Build server
    port         = _pick_port(CALLBACK_PORT)
    redirect_uri = f"http://localhost:{port}/callback"
    state        = secrets.token_urlsafe(16)

    server                  = HTTPServer(("127.0.0.1", port), _Handler)
    server.allow_reuse_address = True
    server.auth_result      = None
    server.got_result       = threading.Event()
    server.expected_state   = state

    # serve_forever() blocks, so run it in a daemon thread
    serve_thread = threading.Thread(target=server.serve_forever, daemon=True)
    serve_thread.start()

    # 2. Open browser
    auth_url = MS_AUTH_URL + "?" + urlencode({
        "client_id":     CLIENT_ID,
        "response_type": "code",
        "redirect_uri":  redirect_uri,
        "scope":         SCOPE,
        "state":         state,
        "prompt":        "select_account",
    })

    p("Opening Microsoft login in your browser…")
    _open_browser(auth_url)
    p("Waiting for you to sign in…")

    # 3. Wait for the handler to set got_result
    finished = server.got_result.wait(timeout=LOGIN_TIMEOUT)

    # 4. Shut down serve_forever() safely from this (main) thread
    #    shutdown() sends a signal through the internal _BaseServer.__shutdown_request
    #    pipe, which wakes up the poll loop cleanly — no deadlock.
    server.shutdown()
    server.server_close()

    if not finished or server.auth_result is None:
        raise RuntimeError("Login timed out after 5 minutes. Please try again.")

    result = server.auth_result
    if "error" in result:
        raise RuntimeError(f"Microsoft login failed: {result['error']}")

    # 5. Exchange code for MS tokens
    p("Exchanging authorization code…")
    ms_tokens = _exchange_code(result["code"], redirect_uri)

    # 6. Full Minecraft auth chain
    return _complete_auth(ms_tokens, p)


# ── Token exchange ─────────────────────────────────────────────────────────────

def _exchange_code(code: str, redirect_uri: str) -> dict:
    resp = requests.post(MS_TOKEN_URL, data={
        "client_id":    CLIENT_ID,
        "code":         code,
        "grant_type":   "authorization_code",
        "redirect_uri": redirect_uri,
        "scope":        SCOPE,
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()


def refresh_ms_token(refresh_token: str) -> dict:
    resp = requests.post(MS_TOKEN_URL, data={
        "client_id":     CLIENT_ID,
        "refresh_token": refresh_token,
        "grant_type":    "refresh_token",
        "redirect_uri":  REDIRECT_URI,
        "scope":         SCOPE,
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()


# ── Minecraft auth chain ───────────────────────────────────────────────────────

def _xbox_live_auth(ms_access_token: str) -> tuple[str, str]:
    resp = requests.post(XBL_AUTH_URL, json={
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName":   "user.auth.xboxlive.com",
            "RpsTicket":  f"d={ms_access_token}",
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType":    "JWT",
    }, headers={"Content-Type": "application/json", "Accept": "application/json"}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["Token"], data["DisplayClaims"]["xui"][0]["uhs"]


def _xsts_auth(xbl_token: str) -> tuple[str, str]:
    resp = requests.post(XSTS_AUTH_URL, json={
        "Properties": {
            "SandboxId":  "RETAIL",
            "UserTokens": [xbl_token],
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType":    "JWT",
    }, headers={"Content-Type": "application/json", "Accept": "application/json"}, timeout=30)
    if resp.status_code == 401:
        err = resp.json().get("XErr", 0)
        if err == 2148916233:
            raise RuntimeError("No Xbox account linked. Visit xbox.com to create one.")
        if err == 2148916238:
            raise RuntimeError("Child account — add it to a Family at xbox.com.")
        raise RuntimeError(f"XSTS auth failed (XErr={err})")
    resp.raise_for_status()
    data = resp.json()
    return data["Token"], data["DisplayClaims"]["xui"][0]["uhs"]


def _minecraft_auth(xsts_token: str, user_hash: str) -> str:
    resp = requests.post(MC_AUTH_URL, json={
        "identityToken": f"XBL3.0 x={user_hash};{xsts_token}",
    }, headers={"Content-Type": "application/json"}, timeout=30)
    resp.raise_for_status()
    return resp.json()["access_token"]


def _fetch_profile(mc_access_token: str) -> dict:
    resp = requests.get(MC_PROFILE_URL, headers={
        "Authorization": f"Bearer {mc_access_token}",
    }, timeout=30)
    if resp.status_code == 404:
        raise RuntimeError("This Microsoft account does not own Minecraft Java Edition.")
    resp.raise_for_status()
    return resp.json()


def _dashed_uuid(raw: str) -> str:
    return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"


def _complete_auth(ms_tokens: dict, p=None) -> dict:
    def _p(msg):
        if p:
            p(msg)
    xbl_token, _    = _xbox_live_auth(ms_tokens["access_token"])
    _p("Getting XSTS token…")
    xsts_token, uh  = _xsts_auth(xbl_token)
    _p("Authenticating with Minecraft services…")
    mc_token        = _minecraft_auth(xsts_token, uh)
    _p("Fetching Minecraft profile…")
    profile         = _fetch_profile(mc_token)
    mc_uuid = _dashed_uuid(profile["id"])
    return {
        "id":           mc_uuid,  # Use Minecraft UUID as the primary ID
        "username":     profile["name"],
        "uuid":         mc_uuid,
        "accessToken":  mc_token,
        "refreshToken": ms_tokens.get("refresh_token", ""),
        "isActive":     True,
    }


def authenticate_from_refresh(refresh_token: str) -> dict:
    """Re-authenticate using a saved refresh token (called before every launch)."""
    ms_tokens = refresh_ms_token(refresh_token)
    return _complete_auth(ms_tokens)


def validate_token(mc_access_token: str) -> bool:
    """Return True if the MC access token is still valid."""
    try:
        r = requests.get(MC_PROFILE_URL,
                         headers={"Authorization": f"Bearer {mc_access_token}"},
                         timeout=10)
        return r.status_code == 200
    except Exception:
        return False

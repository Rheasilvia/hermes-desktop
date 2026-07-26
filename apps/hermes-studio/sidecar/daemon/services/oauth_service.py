"""OAuthService — PKCE + device-code flows for model provider authorization.

Reuses stateless helpers from ``hermes_cli`` / ``agent.anthropic_adapter``
while keeping session state local to the Desktop backend process.

The Desktop backend is a thin API wrapper over ``hermes_cli`` internals —
this follows the same pattern as ModelService, PluginsHub, etc.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import stat
import threading
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

log = logging.getLogger(__name__)

# ── Session management (in-memory, mirrors TUI design) ──────────────────────

_OAUTH_SESSION_TTL_SECONDS = 600  # 10 minutes

_oauth_sessions: Dict[str, Dict[str, Any]] = {}
_oauth_sessions_lock = threading.Lock()


def _gc_oauth_sessions() -> None:
    """Drop expired sessions. Called opportunistically on flow start."""
    cutoff = time.time() - _OAUTH_SESSION_TTL_SECONDS
    with _oauth_sessions_lock:
        stale = [sid for sid, sess in _oauth_sessions.items() if sess.get("created_at", 0) < cutoff]
        for sid in stale:
            _oauth_sessions.pop(sid, None)


def _new_oauth_session(provider_id: str, flow: str) -> Tuple[str, Dict[str, Any]]:
    sid = secrets.token_urlsafe(16)
    sess = {
        "session_id": sid,
        "provider": provider_id,
        "flow": flow,
        "created_at": time.time(),
        "status": "pending",
        "error_message": None,
    }
    with _oauth_sessions_lock:
        _oauth_sessions[sid] = sess
    return sid, sess


# ── Anthropic OAuth helpers (imported from canonical source) ───────────────

try:
    from agent.anthropic_adapter import (
        _OAUTH_CLIENT_ID as _ANTHROPIC_OAUTH_CLIENT_ID,
        _OAUTH_TOKEN_URL as _ANTHROPIC_OAUTH_TOKEN_URL,
        _OAUTH_REDIRECT_URI as _ANTHROPIC_OAUTH_REDIRECT_URI,
        _OAUTH_SCOPES as _ANTHROPIC_OAUTH_SCOPES,
        _generate_pkce as _generate_pkce_pair,
    )
    _ANTHROPIC_OAUTH_AVAILABLE = True
except ImportError:
    _ANTHROPIC_OAUTH_AVAILABLE = False

_ANTHROPIC_OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"


# ── Provider catalog ────────────────────────────────────────────────────────


def _build_provider_catalog() -> Tuple[Dict[str, Any], ...]:
    """Build the OAuth provider catalog dynamically from provider definitions.

    Sources (in priority order):
    1. Import from hermes_cli.web_server (canonical TUI catalog) — strip status_fn.
    2. Fallback: derive from build_models_payload() — any provider whose
       auth_type starts with "oauth" is included. Flow is inferred from
       the auth_type suffix (e.g. oauth_device_code → device_code).

    Status resolution is dispatched by provider_id in _resolve_status().
    """
    # ── Primary: import TUI catalog ──────────────────────────────────────
    try:
        from hermes_cli.web_server import _OAUTH_PROVIDER_CATALOG as _TUI_CATALOG
        catalog: list[Dict[str, Any]] = []
        for entry in _TUI_CATALOG:
            catalog.append({
                k: v for k, v in entry.items() if k != "status_fn"
            })
        log.debug("OAuth catalog loaded from TUI: %d providers", len(catalog))
        return tuple(catalog)
    except Exception:
        log.debug("Cannot import TUI OAuth catalog, building dynamically")

    # ── Fallback: derive from provider registry ──────────────────────────
    try:
        from hermes_cli.inventory import build_models_payload, load_picker_context
        ctx = load_picker_context()
        payload = build_models_payload(
            ctx, include_unconfigured=True, picker_hints=False, canonical_order=True,
        )
        catalog = []
        _AUTH_TO_FLOW: Dict[str, str] = {
            "oauth_device_code": "device_code",
            "oauth_pkce": "pkce",
            "oauth_external": "external",
            "oauth_minimax": "device_code",
        }
        for row in payload.get("providers", []):
            auth_type = str(row.get("auth_type", "") or "")
            if not auth_type.startswith("oauth"):
                continue
            slug = row.get("slug", "")
            flow = _AUTH_TO_FLOW.get(auth_type, "device_code")
            catalog.append({
                "id": slug,
                "name": row.get("name", slug),
                "flow": flow,
                "cli_command": f"hermes auth add {slug}",
                "docs_url": None,
            })
        log.debug("OAuth catalog built dynamically: %d providers", len(catalog))
        return tuple(catalog)
    except Exception:
        log.exception("Failed to build OAuth catalog dynamically")

    return ()


_OAUTH_PROVIDER_CATALOG = _build_provider_catalog()


# ── Token truncation helper ─────────────────────────────────────────────────


def _truncate_token(value: Any, visible: int = 12) -> str:
    """Return a safe preview of an OAuth token for display."""
    if not value:
        return ""
    if callable(value) and not isinstance(value, str):
        return "<entra-id-bearer>"
    s = str(value)
    if "." in s and s.count(".") >= 2:
        s = s.rsplit(".", 1)[-1]
    if len(s) <= visible:
        return s
    return f"…{s[-visible:]}"


# ── Status resolution ───────────────────────────────────────────────────────


def _resolve_status(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve connection status for a single OAuth provider entry."""
    provider_id = entry["id"]
    flow = entry["flow"]
    base = {
        "id": provider_id,
        "name": entry["name"],
        "flow": flow,
        "logged_in": False,
        "source": None,
    }

    if provider_id == "anthropic":
        return {**base, **_anthropic_status()}
    if provider_id == "claude-code":
        return {**base, **_claude_code_status()}
    if provider_id == "nous":
        return {**base, **_nous_status()}
    if provider_id == "openai-codex":
        return {**base, **_codex_status()}
    if provider_id == "qwen-oauth":
        return {**base, **_qwen_status()}
    if provider_id == "minimax-oauth":
        return {**base, **_minimax_status()}

    return base


def _anthropic_status() -> Dict[str, Any]:
    """Check Anthropic credential status (Hermes PKCE, Claude Code, env)."""
    try:
        from agent.anthropic_adapter import (
            read_hermes_oauth_credentials,
            read_claude_code_credentials,
            _HERMES_OAUTH_FILE,
        )
    except ImportError:
        read_hermes_oauth_credentials = None
        read_claude_code_credentials = None
        _HERMES_OAUTH_FILE = None

    hermes_creds = None
    if read_hermes_oauth_credentials:
        try:
            hermes_creds = read_hermes_oauth_credentials()
        except Exception:
            hermes_creds = None
    if hermes_creds and hermes_creds.get("accessToken"):
        return {
            "logged_in": True,
            "source": "hermes_pkce",
            "source_label": f"Hermes PKCE ({_HERMES_OAUTH_FILE})",
            "token_preview": _truncate_token(hermes_creds.get("accessToken")),
            "expires_at": hermes_creds.get("expiresAt"),
            "has_refresh_token": bool(hermes_creds.get("refreshToken")),
        }

    cc_creds = None
    if read_claude_code_credentials:
        try:
            cc_creds = read_claude_code_credentials()
        except Exception:
            cc_creds = None
    if cc_creds and cc_creds.get("accessToken"):
        return {
            "logged_in": True,
            "source": "claude_code",
            "source_label": "Claude Code (~/.claude/.credentials.json)",
            "token_preview": _truncate_token(cc_creds.get("accessToken")),
            "expires_at": cc_creds.get("expiresAt"),
            "has_refresh_token": bool(cc_creds.get("refreshToken")),
        }

    env_token = os.getenv("ANTHROPIC_TOKEN") or os.getenv("CLAUDE_CODE_OAUTH_TOKEN")
    if env_token:
        return {
            "logged_in": True,
            "source": "env_var",
            "source_label": "ANTHROPIC_TOKEN environment variable",
            "token_preview": _truncate_token(env_token),
            "expires_at": None,
            "has_refresh_token": False,
        }
    return {"logged_in": False, "source": None}


def _claude_code_status() -> Dict[str, Any]:
    try:
        from agent.anthropic_adapter import read_claude_code_credentials
        creds = read_claude_code_credentials()
    except Exception:
        creds = None
    if creds and creds.get("accessToken"):
        return {
            "logged_in": True,
            "source": "claude_code_cli",
            "source_label": "~/.claude/.credentials.json",
            "token_preview": _truncate_token(creds.get("accessToken")),
            "expires_at": creds.get("expiresAt"),
            "has_refresh_token": bool(creds.get("refreshToken")),
        }
    return {"logged_in": False, "source": None}


def _nous_status() -> Dict[str, Any]:
    try:
        from hermes_cli import auth as hauth
        raw = hauth.get_nous_auth_status()
        return {
            "logged_in": bool(raw.get("logged_in")),
            "source": "nous_portal",
            "source_label": raw.get("portal_base_url") or "Nous Portal",
            "token_preview": _truncate_token(raw.get("access_token")),
            "expires_at": raw.get("access_expires_at"),
            "has_refresh_token": bool(raw.get("has_refresh_token")),
        }
    except Exception:
        return {"logged_in": False, "source": None}


def _codex_status() -> Dict[str, Any]:
    try:
        from hermes_cli import auth as hauth
        raw = hauth.get_codex_auth_status()
        return {
            "logged_in": bool(raw.get("logged_in")),
            "source": "openai_codex",
            "source_label": raw.get("auth_mode") or "OpenAI Codex",
            "token_preview": _truncate_token(raw.get("api_key")),
            "expires_at": None,
            "has_refresh_token": False,
        }
    except Exception:
        return {"logged_in": False, "source": None}


def _qwen_status() -> Dict[str, Any]:
    try:
        from hermes_cli import auth as hauth
        raw = hauth.get_qwen_auth_status()
        return {
            "logged_in": bool(raw.get("logged_in")),
            "source": "qwen_cli",
            "source_label": raw.get("auth_store_path") or "Qwen CLI",
            "token_preview": _truncate_token(raw.get("access_token")),
            "expires_at": raw.get("expires_at"),
            "has_refresh_token": bool(raw.get("has_refresh_token")),
        }
    except Exception:
        return {"logged_in": False, "source": None}


def _minimax_status() -> Dict[str, Any]:
    try:
        from hermes_cli import auth as hauth
        raw = hauth.get_minimax_oauth_auth_status()
        return {
            "logged_in": bool(raw.get("logged_in")),
            "source": "minimax_oauth",
            "source_label": f"MiniMax ({raw.get('region', 'global')})",
            "token_preview": None,
            "expires_at": None,
            "has_refresh_token": False,
            "last_refresh": raw.get("last_refresh"),
        }
    except Exception:
        return {"logged_in": False, "source": None}


# ── Credential persistence ──────────────────────────────────────────────────


def _save_anthropic_oauth_creds(
    access_token: str, refresh_token: str, expires_at_ms: int
) -> None:
    """Persist Anthropic PKCE creds to file + credential pool.

    Same behaviour as TUI's ``hermes auth add anthropic``.
    """
    try:
        from agent.anthropic_adapter import _HERMES_OAUTH_FILE
    except ImportError:
        raise RuntimeError("Anthropic OAuth file path not available")

    payload = {
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresAt": expires_at_ms,
    }
    _HERMES_OAUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = _HERMES_OAUTH_FILE.with_name(
        f"{_HERMES_OAUTH_FILE.name}.tmp.{os.getpid()}.{secrets.token_hex(8)}"
    )
    try:
        with tmp_path.open("w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, indent=2))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, _HERMES_OAUTH_FILE)
        try:
            _HERMES_OAUTH_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass

    # Best-effort credential-pool insert
    try:
        from agent.credential_pool import (
            PooledCredential,
            load_pool,
            AUTH_TYPE_OAUTH,
            SOURCE_MANUAL,
        )
        import uuid
        pool = load_pool("anthropic")
        label = "desktop PKCE"
        existing = [
            e for e in pool.entries()
            if getattr(e, "source", "").startswith(f"{SOURCE_MANUAL}:{label}")
        ]
        for e in existing:
            try:
                pool.remove_entry(getattr(e, "id", ""))
            except Exception:
                pass
        entry = PooledCredential(
            provider="anthropic",
            id=uuid.uuid4().hex[:6],
            label=label,
            auth_type=AUTH_TYPE_OAUTH,
            priority=0,
            source=f"{SOURCE_MANUAL}:{label}",
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at_ms=expires_at_ms,
        )
        pool.add_entry(entry)
    except Exception:
        log.warning("anthropic pool add (desktop) failed", exc_info=True)


# ── PKCE flow (Anthropic) ───────────────────────────────────────────────────


def start_pkce(provider_id: str) -> Dict[str, Any]:
    """Begin Anthropic PKCE flow. Returns auth_url for the UI to open."""
    if not _ANTHROPIC_OAUTH_AVAILABLE:
        raise RuntimeError("Anthropic OAuth not available (missing adapter)")
    _gc_oauth_sessions()
    verifier, challenge = _generate_pkce_pair()
    sid, sess = _new_oauth_session(provider_id, "pkce")
    sess["verifier"] = verifier
    sess["state"] = verifier
    params = {
        "code": "true",
        "client_id": _ANTHROPIC_OAUTH_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": _ANTHROPIC_OAUTH_REDIRECT_URI,
        "scope": _ANTHROPIC_OAUTH_SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": verifier,
    }
    auth_url = f"{_ANTHROPIC_OAUTH_AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"
    return {
        "session_id": sid,
        "flow": "pkce",
        "auth_url": auth_url,
        "expires_in": _OAUTH_SESSION_TTL_SECONDS,
    }


def submit_pkce(session_id: str, code_input: str) -> Dict[str, Any]:
    """Exchange authorization code for tokens. Persists on success."""
    with _oauth_sessions_lock:
        sess = _oauth_sessions.get(session_id)
    if not sess or sess.get("provider") != "anthropic" or sess.get("flow") != "pkce":
        raise RuntimeError("Unknown or expired session")
    if sess["status"] != "pending":
        return {"ok": False, "status": sess["status"], "message": sess.get("error_message")}

    parts = code_input.strip().split("#", 1)
    code = parts[0].strip()
    if not code:
        return {"ok": False, "status": "error", "message": "No code provided"}
    state_from_callback = parts[1] if len(parts) > 1 else ""

    exchange_data = json.dumps({
        "grant_type": "authorization_code",
        "client_id": _ANTHROPIC_OAUTH_CLIENT_ID,
        "code": code,
        "state": state_from_callback or sess.get("state", ""),
        "redirect_uri": _ANTHROPIC_OAUTH_REDIRECT_URI,
        "code_verifier": sess.get("verifier", ""),
    }).encode()
    req = urllib.request.Request(
        _ANTHROPIC_OAUTH_TOKEN_URL,
        data=exchange_data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "hermes-desktop/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode())
    except Exception as e:
        with _oauth_sessions_lock:
            sess["status"] = "error"
            sess["error_message"] = f"Token exchange failed: {e}"
        return {"ok": False, "status": "error", "message": sess["error_message"]}

    access_token = result.get("access_token", "")
    refresh_token = result.get("refresh_token", "")
    expires_in = int(result.get("expires_in") or 3600)
    if not access_token:
        with _oauth_sessions_lock:
            sess["status"] = "error"
            sess["error_message"] = "No access token returned"
        return {"ok": False, "status": "error", "message": sess["error_message"]}

    expires_at_ms = int(time.time() * 1000) + (expires_in * 1000)
    try:
        _save_anthropic_oauth_creds(access_token, refresh_token, expires_at_ms)
    except Exception as e:
        with _oauth_sessions_lock:
            sess["status"] = "error"
            sess["error_message"] = f"Save failed: {e}"
        return {"ok": False, "status": "error", "message": sess["error_message"]}
    with _oauth_sessions_lock:
        sess["status"] = "approved"
    log.info("oauth/pkce: anthropic login completed (session=%s)", session_id)
    return {"ok": True, "status": "approved"}


# ── Device-code flow (Nous, Codex, MiniMax) ─────────────────────────────────


async def start_device_code_flow(provider_id: str) -> Dict[str, Any]:
    """Initiate a device-code flow. Returns user_code + verification_url."""
    _gc_oauth_sessions()

    if provider_id == "nous":
        return await _start_nous_device_code()
    if provider_id == "openai-codex":
        return await _start_codex_device_code()
    if provider_id == "minimax-oauth":
        return await _start_minimax_device_code()

    raise RuntimeError(
        f"Provider {provider_id} does not support device-code flow"
    )


async def _start_nous_device_code() -> Dict[str, Any]:
    from hermes_cli.auth import (
        _request_device_code,
        PROVIDER_REGISTRY,
    )
    import httpx
    pconfig = PROVIDER_REGISTRY["nous"]
    portal_base_url = (
        os.getenv("HERMES_PORTAL_BASE_URL")
        or os.getenv("NOUS_PORTAL_BASE_URL")
        or pconfig.portal_base_url
    ).rstrip("/")
    client_id = pconfig.client_id
    scope = pconfig.scope

    def _do_request():
        with httpx.Client(
            timeout=httpx.Timeout(15.0),
            headers={"Accept": "application/json"},
        ) as client:
            return _request_device_code(
                client=client,
                portal_base_url=portal_base_url,
                client_id=client_id,
                scope=scope,
            )

    device_data, effective_scope = await asyncio.get_running_loop().run_in_executor(
        None, _do_request
    )
    sid, sess = _new_oauth_session("nous", "device_code")
    sess["device_code"] = str(device_data["device_code"])
    sess["interval"] = int(device_data["interval"])
    sess["expires_at"] = time.time() + int(device_data["expires_in"])
    sess["portal_base_url"] = portal_base_url
    sess["client_id"] = client_id
    sess["scope"] = effective_scope
    threading.Thread(
        target=_nous_poller, args=(sid,), daemon=True, name=f"desk-oauth-poll-{sid[:6]}"
    ).start()
    return {
        "session_id": sid,
        "flow": "device_code",
        "user_code": str(device_data["user_code"]),
        "verification_url": str(device_data["verification_uri_complete"]),
        "expires_in": int(device_data["expires_in"]),
        "poll_interval": int(device_data["interval"]),
    }


def _nous_poller(session_id: str) -> None:
    """Background poller for Nous device-code flow."""
    from hermes_cli.auth import (
        _poll_for_token,
        refresh_nous_oauth_from_state,
        persist_nous_credentials,
    )
    from datetime import datetime, timezone
    import httpx
    with _oauth_sessions_lock:
        sess = _oauth_sessions.get(session_id)
    if not sess:
        return
    portal_base_url = sess["portal_base_url"]
    client_id = sess["client_id"]
    device_code = sess["device_code"]
    interval = sess["interval"]
    scope = sess.get("scope")
    expires_in = max(60, int(sess["expires_at"] - time.time()))
    try:
        with httpx.Client(
            timeout=httpx.Timeout(15.0), headers={"Accept": "application/json"}
        ) as client:
            token_data = _poll_for_token(
                client=client,
                portal_base_url=portal_base_url,
                client_id=client_id,
                device_code=device_code,
                expires_in=expires_in,
                poll_interval=interval,
            )
        now = datetime.now(timezone.utc)
        token_ttl = int(token_data.get("expires_in") or 0)
        auth_state = {
            "portal_base_url": portal_base_url,
            "inference_base_url": token_data.get("inference_base_url"),
            "client_id": client_id,
            "scope": token_data.get("scope") or scope,
            "token_type": token_data.get("token_type", "Bearer"),
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "obtained_at": now.isoformat(),
            "expires_at": (
                datetime.fromtimestamp(
                    now.timestamp() + token_ttl, tz=timezone.utc
                ).isoformat()
                if token_ttl else None
            ),
            "expires_in": token_ttl,
        }
        full_state = refresh_nous_oauth_from_state(
            auth_state, timeout_seconds=15.0, force_refresh=False,
        )
        persist_nous_credentials(full_state)
        with _oauth_sessions_lock:
            sess["status"] = "approved"
        log.info("oauth/device: nous login completed (session=%s)", session_id)
    except Exception as e:
        with _oauth_sessions_lock:
            sess["status"] = "error"
            sess["error_message"] = str(e)
        log.warning("oauth/device: nous poll failed (session=%s): %s", session_id, e)


async def _start_codex_device_code() -> Dict[str, Any]:
    """Initiate OpenAI Codex device-code flow.

    Codex uses its own proprietary protocol (deviceauth/usercode + deviceauth/token
    + authorization_code exchange), not the standard OAuth device-code endpoints.
    This mirrors the TUI's _codex_full_login_worker inline implementation.
    """
    sid, _ = _new_oauth_session("openai-codex", "device_code")
    threading.Thread(
        target=_codex_full_login_worker, args=(sid,), daemon=True,
        name=f"desk-oauth-codex-{sid[:6]}",
    ).start()
    # Block briefly until the worker populates user_code or errors
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with _oauth_sessions_lock:
            s = _oauth_sessions.get(sid)
        if s and (s.get("user_code") or s["status"] != "pending"):
            break
        await asyncio.sleep(0.1)
    with _oauth_sessions_lock:
        s = _oauth_sessions.get(sid, {})
    if s.get("status") == "error":
        raise RuntimeError(s.get("error_message") or "device-auth failed")
    if not s.get("user_code"):
        raise RuntimeError("device-auth timed out before returning a user code")
    return {
        "session_id": sid,
        "flow": "device_code",
        "user_code": s["user_code"],
        "verification_url": s["verification_url"],
        "expires_in": int(s.get("expires_in") or 900),
        "poll_interval": int(s.get("interval") or 5),
    }


def _codex_full_login_worker(session_id: str) -> None:
    """Run the complete OpenAI Codex device-code flow.

    Uses Codex's proprietary /deviceauth endpoints (not standard OAuth device-code).
    Uses curl_cffi with browser TLS fingerprint impersonation to pass Cloudflare's
    bot protection on auth.openai.com. Falls back to httpx when curl_cffi is
    unavailable (with a warning — Cloudflare will likely block the request).
    """
    # ── HTTP client selection ─────────────────────────────────────────────
    # auth.openai.com is behind Cloudflare Bot Management. httpx gets 429'd;
    # curl_cffi with browser impersonation passes through.
    try:
        from curl_cffi.requests import Session as CurlSession  # noqa: F811
        _USE_CURL_CFFI = True
    except ImportError:
        _USE_CURL_CFFI = False
        log.warning(
            "curl_cffi not available — Codex auth may fail due to "
            "Cloudflare bot protection on auth.openai.com"
        )

    if _USE_CURL_CFFI:
        _session = CurlSession()
        def _post(url, timeout=30, **kw):
            return _session.post(
                url, headers={"Content-Type": "application/json"}, **kw,
                impersonate="chrome124", timeout=timeout,
            )
        def _post_form(url, **kw):
            return _session.post(
                url,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                **kw, impersonate="chrome124", timeout=30,
            )
        def _safe_json(resp, label="response"):
            """Parse JSON body, raising a clear error when the response is HTML
            (Cloudflare challenge) or empty."""
            ct = resp.headers.get("content-type", "")
            if "text/html" in ct:
                snippet = (resp.text or "")[:200]
                raise RuntimeError(
                    f"{label}: received HTML (status {resp.status_code}) — "
                    f"likely Cloudflare challenge. Snippet: {snippet}"
                )
            if not (resp.text or "").strip():
                raise RuntimeError(
                    f"{label}: empty response body (status {resp.status_code})"
                )
            return resp.json()
    else:
        import httpx
        _client = httpx.Client(timeout=httpx.Timeout(30.0))
        def _post(url, timeout=30, **kw):
            return _client.post(
                url, headers={"Content-Type": "application/json"}, **kw,
            )
        def _post_form(url, **kw):
            return _client.post(
                url,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                **kw,
            )
        def _safe_json(resp, label="response"):
            ct = resp.headers.get("content-type", "")
            if "text/html" in ct:
                snippet = (resp.text or "")[:200]
                raise RuntimeError(
                    f"{label}: received HTML (status {resp.status_code}) — "
                    f"likely Cloudflare challenge. Snippet: {snippet}"
                )
            if not (resp.text or "").strip():
                raise RuntimeError(
                    f"{label}: empty response body (status {resp.status_code})"
                )
            return resp.json()

    try:
        from hermes_cli.auth import (
            CODEX_OAUTH_CLIENT_ID,
            CODEX_OAUTH_TOKEN_URL,
            DEFAULT_CODEX_BASE_URL,
        )
        issuer = "https://auth.openai.com"

        # Step 1: request device code
        resp = _post(
            f"{issuer}/api/accounts/deviceauth/usercode",
            json={"client_id": CODEX_OAUTH_CLIENT_ID},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"deviceauth/usercode returned {resp.status_code}")
        device_data = _safe_json(resp, "deviceauth/usercode")
        user_code = device_data.get("user_code", "")
        device_auth_id = device_data.get("device_auth_id", "")
        poll_interval = max(3, int(device_data.get("interval", "5")))
        if not user_code or not device_auth_id:
            raise RuntimeError("device-code response missing user_code or device_auth_id")
        verification_url = f"{issuer}/codex/device"
        with _oauth_sessions_lock:
            sess = _oauth_sessions.get(session_id)
            if not sess:
                return
            sess["user_code"] = user_code
            sess["verification_url"] = verification_url
            sess["device_auth_id"] = device_auth_id
            sess["interval"] = poll_interval
            sess["expires_in"] = 15 * 60
            sess["expires_at"] = time.time() + sess["expires_in"]

        # Step 2: poll until authorized
        deadline_ts = time.monotonic() + sess["expires_in"]
        code_resp = None
        while time.monotonic() < deadline_ts:
            time.sleep(poll_interval)
            poll = _post(
                f"{issuer}/api/accounts/deviceauth/token",
                json={"device_auth_id": device_auth_id, "user_code": user_code},
            )
            if poll.status_code == 200:
                ct = poll.headers.get("content-type", "")
                if "text/html" in ct or not (poll.text or "").strip():
                    # Cloudflare intermediate page or empty response —
                    # user hasn't authorized yet, keep polling.
                    log.debug(
                        "codex poll: got HTML/empty (status 200), "
                        "continuing (session=%s)", session_id[:8],
                    )
                    continue
                try:
                    code_resp = _safe_json(poll, "deviceauth/token poll")
                    break
                except Exception:
                    # Parse failure on what looked like JSON — keep polling
                    log.debug(
                        "codex poll: JSON parse failed on 200 response, "
                        "continuing (session=%s)", session_id[:8],
                    )
                    continue
            if poll.status_code in {403, 404}:
                continue  # user hasn't authorized yet
            raise RuntimeError(
                f"deviceauth/token poll returned {poll.status_code}"
            )

        if code_resp is None:
            with _oauth_sessions_lock:
                sess["status"] = "expired"
                sess["error_message"] = "Device code expired before approval"
            return

        # Step 3: exchange authorization_code for tokens (form-encoded)
        authorization_code = code_resp.get("authorization_code", "")
        code_verifier = code_resp.get("code_verifier", "")
        if not authorization_code or not code_verifier:
            raise RuntimeError(
                "device-auth response missing authorization_code/code_verifier"
            )

        token_resp = _post_form(
            CODEX_OAUTH_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": authorization_code,
                "redirect_uri": f"{issuer}/deviceauth/callback",
                "client_id": CODEX_OAUTH_CLIENT_ID,
                "code_verifier": code_verifier,
            },
        )
        if token_resp.status_code != 200:
            raise RuntimeError(
                f"Codex token exchange returned {token_resp.status_code}: "
                f"{token_resp.text[:200]}"
            )
        tokens = _safe_json(token_resp, "token exchange")
        access_token = tokens.get("access_token", "")
        if not access_token:
            raise RuntimeError("Codex token exchange returned no access_token")

        # Persist via credential pool (mirrors TUI's _codex_full_login_worker)
        from agent.credential_pool import (
            PooledCredential,
            load_pool,
            AUTH_TYPE_OAUTH,
            SOURCE_MANUAL,
        )
        import uuid as _uuid
        pool = load_pool("openai-codex")
        base_url = (
            os.getenv("HERMES_CODEX_BASE_URL", "").strip().rstrip("/")
            or DEFAULT_CODEX_BASE_URL
        )
        entry = PooledCredential(
            provider="openai-codex",
            id=_uuid.uuid4().hex[:6],
            label="desktop device_code",
            auth_type=AUTH_TYPE_OAUTH,
            priority=0,
            source=f"{SOURCE_MANUAL}:desktop_device_code",
            access_token=access_token,
            refresh_token=tokens.get("refresh_token"),
            base_url=base_url,
        )
        pool.add_entry(entry)
        with _oauth_sessions_lock:
            sess["status"] = "approved"
        log.info(
            "oauth/device: codex login completed (session=%s)", session_id
        )
    except Exception as e:
        with _oauth_sessions_lock:
            s = _oauth_sessions.get(session_id)
            if s:
                s["status"] = "error"
                s["error_message"] = str(e)
        log.warning(
            "oauth/device: codex login failed (session=%s): %s", session_id, e
        )


async def _start_minimax_device_code() -> Dict[str, Any]:
    """Initiate MiniMax device-code flow."""
    from hermes_cli.auth import (
        _minimax_pkce_pair,
        _minimax_request_user_code,
        MINIMAX_OAUTH_CLIENT_ID,
        MINIMAX_OAUTH_GLOBAL_BASE,
    )
    import httpx
    verifier, challenge, state = _minimax_pkce_pair()
    portal_base_url = (
        os.getenv("MINIMAX_PORTAL_BASE_URL") or MINIMAX_OAUTH_GLOBAL_BASE
    ).rstrip("/")

    def _do_request():
        with httpx.Client(
            timeout=httpx.Timeout(15.0),
            headers={"Accept": "application/json"},
            follow_redirects=True,
        ) as client:
            return _minimax_request_user_code(
                client=client,
                portal_base_url=portal_base_url,
                client_id=MINIMAX_OAUTH_CLIENT_ID,
                code_challenge=challenge,
                state=state,
            )

    device_data = await asyncio.get_event_loop().run_in_executor(None, _do_request)
    sid, sess = _new_oauth_session("minimax-oauth", "device_code")
    interval_raw = device_data.get("interval")
    sess["interval_ms"] = int(interval_raw) if interval_raw is not None else None
    sess["user_code"] = str(device_data["user_code"])
    sess["code_verifier"] = verifier
    sess["state"] = state
    sess["portal_base_url"] = portal_base_url
    sess["client_id"] = MINIMAX_OAUTH_CLIENT_ID
    sess["region"] = "global"
    expired_in_raw = int(device_data["expired_in"])
    sess["expired_in_raw"] = expired_in_raw
    if expired_in_raw > 1_000_000_000_000:
        expires_at_ts = expired_in_raw / 1000.0
        expires_in_seconds = max(0, int(expires_at_ts - time.time()))
    else:
        expires_at_ts = time.time() + expired_in_raw
        expires_in_seconds = expired_in_raw
    sess["expires_at"] = expires_at_ts
    threading.Thread(
        target=_minimax_poller, args=(sid,), daemon=True,
        name=f"desk-oauth-poll-{sid[:6]}",
    ).start()
    return {
        "session_id": sid,
        "flow": "device_code",
        "user_code": str(device_data["user_code"]),
        "verification_url": str(device_data["verification_uri"]),
        "expires_in": expires_in_seconds,
        "poll_interval": max(2, (sess["interval_ms"] or 2000) // 1000),
    }


def _minimax_poller(session_id: str) -> None:
    """Background poller for MiniMax device-code flow.

    Mirrors the TUI's _minimax_poller in hermes_cli/web_server.py.
    """
    try:
        from hermes_cli.auth import (
            _minimax_poll_token,
            _minimax_resolve_token_expiry_unix,
            _minimax_save_auth_state,
            MINIMAX_OAUTH_GLOBAL_INFERENCE,
            MINIMAX_OAUTH_SCOPE,
        )
        import httpx
        from datetime import datetime, timezone
    except ImportError as e:
        with _oauth_sessions_lock:
            s = _oauth_sessions.get(session_id)
            if s:
                s["status"] = "error"
                s["error_message"] = str(e)
        return

    with _oauth_sessions_lock:
        sess = _oauth_sessions.get(session_id)
    if not sess:
        return

    portal_base_url = sess["portal_base_url"]
    client_id = sess["client_id"]
    user_code = sess["user_code"]
    code_verifier = sess["code_verifier"]
    interval_ms = sess.get("interval_ms")
    expired_in_raw = sess["expired_in_raw"]

    try:
        with httpx.Client(
            timeout=httpx.Timeout(15.0),
            headers={"Accept": "application/json"},
            follow_redirects=True,
        ) as client:
            token_data = _minimax_poll_token(
                client=client,
                portal_base_url=portal_base_url,
                client_id=client_id,
                user_code=user_code,
                code_verifier=code_verifier,
                expired_in=expired_in_raw,
                interval_ms=interval_ms,
            )
        # Build auth_state in the same shape as the CLI flow so
        # _minimax_save_auth_state writes the canonical record.
        now = datetime.now(timezone.utc)
        expires_at_ts = _minimax_resolve_token_expiry_unix(
            int(token_data["expired_in"]), now=now,
        )
        expires_in_s = max(0, int(expires_at_ts - now.timestamp()))
        auth_state = {
            "provider": "minimax-oauth",
            "region": sess.get("region", "global"),
            "portal_base_url": portal_base_url,
            "inference_base_url": MINIMAX_OAUTH_GLOBAL_INFERENCE,
            "client_id": client_id,
            "scope": token_data.get("scope") or MINIMAX_OAUTH_SCOPE,
            "token_type": token_data.get("token_type", "Bearer"),
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "obtained_at": now.isoformat(),
            "expires_at": (
                datetime.fromtimestamp(expires_at_ts, tz=timezone.utc).isoformat()
                if expires_at_ts else None
            ),
            "expires_in": expires_in_s,
        }
        _minimax_save_auth_state(auth_state)
        with _oauth_sessions_lock:
            sess["status"] = "approved"
        log.info("oauth/device: minimax login completed (session=%s)", session_id)
    except Exception as e:
        with _oauth_sessions_lock:
            sess["status"] = "error"
            sess["error_message"] = str(e)
        log.warning(
            "oauth/device: minimax poll failed (session=%s): %s", session_id, e
        )


def poll_device_code_session(session_id: str) -> Dict[str, Any]:
    """Poll a device-code session for its current status."""
    with _oauth_sessions_lock:
        sess = _oauth_sessions.get(session_id)
    if not sess:
        raise RuntimeError("Unknown session")
    return {
        "session_id": sess["session_id"],
        "status": sess["status"],
        "error_message": sess.get("error_message"),
    }


# ── Disconnect ──────────────────────────────────────────────────────────────


def disconnect_provider(provider_id: str) -> None:
    """Disconnect / clear OAuth credentials for a provider.

    Mirrors ``hermes auth remove <provider>`` behaviour.
    """
    try:
        from hermes_cli.auth import clear_provider_auth
        ok = clear_provider_auth(provider_id)
        if not ok:
            log.warning("oauth/disconnect: %s — no credentials to clear", provider_id)
        else:
            log.info("oauth/disconnect: %s credentials cleared", provider_id)
    except Exception as e:
        raise RuntimeError(f"Failed to disconnect {provider_id}: {e}") from e

    # Also clear Anthropic file if disconnecting anthropic
    if provider_id == "anthropic":
        try:
            from agent.anthropic_adapter import _HERMES_OAUTH_FILE
            if _HERMES_OAUTH_FILE.exists():
                _HERMES_OAUTH_FILE.unlink()
        except Exception:
            pass


# ── Public API ──────────────────────────────────────────────────────────────


def list_providers() -> list[Dict[str, Any]]:
    """List all OAuth providers with connection status."""
    return [_resolve_status(entry) for entry in _OAUTH_PROVIDER_CATALOG]


def get_provider_entry(provider_id: str) -> Optional[Dict[str, Any]]:
    """Find a provider in the catalog by ID."""
    for entry in _OAUTH_PROVIDER_CATALOG:
        if entry["id"] == provider_id:
            return _resolve_status(entry)
    return None


def cancel_session(session_id: str) -> None:
    """Cancel a pending OAuth session."""
    with _oauth_sessions_lock:
        if session_id in _oauth_sessions:
            _oauth_sessions[session_id]["status"] = "denied"
            _oauth_sessions[session_id]["error_message"] = "Cancelled by user"

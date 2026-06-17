from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from pydantic import ValidationError

from ..db.connection import connect, ensure_schema
from ..schemas.mcp import (
    McpServer,
    McpServerCreate,
    McpServerDesktop,
    McpTool,
    PatchMcpServerDesktopRequest,
)
from .exceptions import (
    McpServerConflictError,
    McpServerNotFoundError,
    McpUnavailableError,
    McpValidationError,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _transport_for(cfg: dict[str, Any]) -> str:
    if "url" in cfg:
        return str(cfg.get("transport") or "http")
    return str(cfg.get("transport") or "stdio")


def _valid_transport(value: str) -> bool:
    return value in {"stdio", "http", "streamable_http", "sse"}


class McpService:
    def __init__(self, hermes_home: Path):
        self._hermes_home = hermes_home

    def _load_config(self) -> dict[str, Any]:
        from hermes_cli.config import load_config

        token = set_hermes_home_override(self._hermes_home)
        try:
            return load_config()
        finally:
            reset_hermes_home_override(token)

    def _save_config(self, config: dict[str, Any]) -> None:
        from hermes_cli.config import save_config

        token = set_hermes_home_override(self._hermes_home)
        try:
            save_config(config)
        finally:
            reset_hermes_home_override(token)

    def _load_meta(self) -> dict[str, McpServerDesktop]:
        conn = connect(self._hermes_home)
        ensure_schema(conn)
        try:
            rows = conn.execute(
                "SELECT server_name, pinned, note, display_order, last_selected_at, updated_at "
                "FROM mcp_server_meta"
            ).fetchall()
        finally:
            conn.close()
        return {
            row["server_name"]: McpServerDesktop(
                pinned=bool(row["pinned"]),
                note=row["note"],
                display_order=row["display_order"],
                last_selected_at=row["last_selected_at"],
                updated_at=row["updated_at"],
            )
            for row in rows
        }

    def _get_meta(self, name: str) -> McpServerDesktop:
        return self._load_meta().get(name, McpServerDesktop())

    def _patch_meta(self, name: str, patch: PatchMcpServerDesktopRequest) -> McpServerDesktop:
        current = self._get_meta(name)
        updates = patch.model_dump(exclude_unset=True)
        payload = current.model_dump()
        payload.update(updates)
        payload["updated_at"] = _now_iso()
        meta = McpServerDesktop(**payload)
        conn = connect(self._hermes_home)
        ensure_schema(conn)
        try:
            conn.execute(
                """
                INSERT INTO mcp_server_meta
                    (server_name, pinned, note, display_order, last_selected_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(server_name) DO UPDATE SET
                    pinned = excluded.pinned,
                    note = excluded.note,
                    display_order = excluded.display_order,
                    last_selected_at = excluded.last_selected_at,
                    updated_at = excluded.updated_at
                """,
                (
                    name,
                    1 if meta.pinned else 0,
                    meta.note,
                    meta.display_order,
                    meta.last_selected_at,
                    meta.updated_at,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return meta

    def _delete_meta(self, name: str) -> None:
        conn = connect(self._hermes_home)
        ensure_schema(conn)
        try:
            conn.execute("DELETE FROM mcp_server_meta WHERE server_name = ?", (name,))
            conn.commit()
        finally:
            conn.close()

    def _status_by_name(self) -> dict[str, dict[str, Any]]:
        token = set_hermes_home_override(self._hermes_home)
        try:
            from tools.mcp_tool import get_mcp_status

            return {
                str(row.get("name")): row
                for row in get_mcp_status()
                if isinstance(row, dict) and row.get("name")
            }
        except ImportError:
            return {}
        finally:
            reset_hermes_home_override(token)

    def _server_from_config(
        self,
        name: str,
        raw: Any,
        *,
        meta: McpServerDesktop,
        status: dict[str, Any] | None = None,
    ) -> McpServer:
        if not isinstance(raw, dict):
            return McpServer(
                name=str(name),
                transport="stdio",
                enabled=False,
                valid=False,
                error="MCP server config must be a mapping",
                desktop=meta,
                status=status,
            )
        payload = dict(raw)
        payload["name"] = str(name)
        for reserved in ("desktop", "error", "status", "valid"):
            payload.pop(reserved, None)
        transport = _transport_for(payload)
        valid = True
        error = None
        if not _valid_transport(transport):
            valid = False
            error = f"Unsupported MCP transport: {transport}"
            transport = "stdio"
        payload["transport"] = transport
        try:
            McpServerCreate(**payload)
        except ValidationError as exc:
            valid = False
            error = "; ".join(
                str(err.get("msg") or err.get("type") or "invalid")
                for err in exc.errors()
            )
        try:
            return McpServer(**payload, valid=valid, error=error, desktop=meta, status=status)
        except ValidationError as exc:
            detail = error or "; ".join(
                str(err.get("msg") or err.get("type") or "invalid")
                for err in exc.errors()
            )
            return McpServer(
                name=str(name),
                transport=transport,
                enabled=False,
                valid=False,
                error=detail,
                desktop=meta,
                status=status,
            )

    def list_servers(self) -> tuple[list[McpServer], str]:
        config = self._load_config()
        servers = config.get("mcp_servers") or {}
        if not isinstance(servers, dict):
            raise McpValidationError("mcp_servers must be a mapping")
        meta_by_name = self._load_meta()
        status_by_name = self._status_by_name()
        items: list[McpServer] = []
        for name, raw in sorted(servers.items()):
            items.append(
                self._server_from_config(
                    str(name),
                    raw,
                    meta=meta_by_name.get(str(name), McpServerDesktop()),
                    status=status_by_name.get(str(name)),
                )
            )
        return items, _now_iso()

    def add_server(self, server: McpServerCreate) -> McpServer:
        config = self._load_config()
        servers = config.get("mcp_servers") or {}
        if not isinstance(servers, dict):
            raise McpValidationError("mcp_servers must be a mapping")
        if server.name in servers:
            raise McpServerConflictError(f"MCP server already exists: {server.name}")
        payload = server.model_dump(exclude={"name"}, exclude_none=True)
        if not payload.get("args"):
            payload.pop("args", None)
        if not payload.get("env"):
            payload.pop("env", None)
        if not payload.get("headers"):
            payload.pop("headers", None)
        if payload.get("transport") == "stdio":
            payload.pop("transport", None)
        try:
            from hermes_cli.mcp_security import validate_mcp_server_entry
        except ImportError as exc:
            raise McpUnavailableError(f"MCP security validator unavailable: {exc}") from exc
        issues = validate_mcp_server_entry(server.name, payload)
        if issues:
            raise McpValidationError("; ".join(issues))
        servers[server.name] = payload
        config["mcp_servers"] = servers
        self._save_config(config)
        return self._server_from_config(
            server.name,
            payload,
            meta=self._get_meta(server.name),
            status=self._status_by_name().get(server.name),
        )

    def remove_server(self, name: str) -> None:
        config = self._load_config()
        servers = config.get("mcp_servers") or {}
        if not isinstance(servers, dict):
            raise McpValidationError("mcp_servers must be a mapping")
        if name not in servers:
            raise McpServerNotFoundError(f"MCP server not found: {name}")
        del servers[name]
        if servers:
            config["mcp_servers"] = servers
        else:
            config.pop("mcp_servers", None)
        self._save_config(config)
        self._delete_meta(name)
        token = set_hermes_home_override(self._hermes_home)
        try:
            from tools.mcp_tool import shutdown_mcp_server

            shutdown_mcp_server(name)
        except ImportError:
            pass
        finally:
            reset_hermes_home_override(token)

    def patch_desktop(self, name: str, body: PatchMcpServerDesktopRequest) -> McpServerDesktop:
        config = self._load_config()
        servers = config.get("mcp_servers") or {}
        if not isinstance(servers, dict):
            raise McpValidationError("mcp_servers must be a mapping")
        if name not in servers:
            raise McpServerNotFoundError(f"MCP server not found: {name}")
        return self._patch_meta(name, body)

    def list_tools(self, name: str) -> tuple[list[McpTool], dict[str, Any] | None]:
        token = set_hermes_home_override(self._hermes_home)
        try:
            from tools.mcp_tool import (
                get_mcp_status,
                sanitize_mcp_name_component,
            )
            from tools.registry import registry

            status = next((s for s in get_mcp_status() if s.get("name") == name), None)
            if status is None:
                raise McpServerNotFoundError(f"MCP server not found: {name}")
            prefix = f"mcp_{sanitize_mcp_name_component(name)}_"
            tools: list[McpTool] = []
            for tool_name in registry.get_all_tool_names():
                if not tool_name.startswith(prefix):
                    continue
                schema = registry.get_schema(tool_name) or {}
                parameters = schema.get("parameters") if isinstance(schema, dict) else None
                native_name = tool_name[len(prefix):] or tool_name
                tools.append(
                    McpTool(
                        name=native_name,
                        description=str(schema.get("description") or ""),
                        inputSchema=parameters if isinstance(parameters, dict) else None,
                    )
                )
            return tools, status
        except McpServerNotFoundError:
            raise
        except ImportError as exc:
            raise McpUnavailableError(f"MCP runtime unavailable: {exc}") from exc
        finally:
            reset_hermes_home_override(token)

    def reload(self, *, agent_pool: Any | None = None) -> tuple[list[McpServer], str, int]:
        token = set_hermes_home_override(self._hermes_home)
        try:
            from tools.mcp_tool import discover_mcp_tools, shutdown_mcp_servers

            shutdown_mcp_servers()
            discover_mcp_tools()
        except ImportError as exc:
            raise McpUnavailableError(f"MCP runtime unavailable: {exc}") from exc
        except Exception as exc:
            raise McpUnavailableError(f"MCP reload failed: {exc}") from exc
        finally:
            reset_hermes_home_override(token)

        refreshed_agents = 0
        if agent_pool is not None:
            refresh = getattr(agent_pool, "refresh_tool_snapshots", None)
            if callable(refresh):
                refreshed_agents = int(refresh() or 0)

        items, generated_at = self.list_servers()
        return items, generated_at, refreshed_agents

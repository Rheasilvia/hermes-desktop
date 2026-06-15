"""DesktopMetaService — wraps db/connection.py for session_desktop_meta CRUD.

Handles all desktop.db session_desktop_meta operations.  Does NOT touch state.db.
"""

from __future__ import annotations

import time
from pathlib import Path

PERMISSION_MODES = frozenset({"ask", "auto", "full"})
REASONING_EFFORTS = frozenset({"none", "minimal", "low", "medium", "high", "xhigh"})
DEFAULT_REASONING_EFFORT = "medium"


def normalize_permission_mode(mode: str | None) -> str:
    value = str(mode or "").strip().lower()
    if value not in PERMISSION_MODES:
        raise ValueError(f"invalid permission mode: {mode}")
    return value


def normalize_reasoning_effort(effort: str | None, *, strict: bool = True) -> str:
    value = str(effort or "").strip().lower()
    if value in REASONING_EFFORTS:
        return value
    if strict:
        raise ValueError(f"invalid reasoning effort: {effort}")
    return DEFAULT_REASONING_EFFORT


class DesktopMetaService:
    """CRUD for the session_desktop_meta table in desktop.db."""

    def __init__(self, hermes_home: Path) -> None:
        self._hermes_home = hermes_home

    def _connect(self):
        from ..db.connection import connect, ensure_schema
        conn = connect(self._hermes_home)
        ensure_schema(conn)
        return conn

    def get_meta(self, session_id: str) -> dict | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT session_id, pinned, archived, "
                "last_opened_at, created_at, provider, permission_mode, reasoning_effort "
                "FROM session_desktop_meta WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def upsert_meta(
        self,
        session_id: str,
        provider: str = "",
        permission_mode: str = "auto",
        reasoning_effort: str = DEFAULT_REASONING_EFFORT,
    ) -> None:
        now = time.time()
        mode = normalize_permission_mode(permission_mode)
        effort = normalize_reasoning_effort(reasoning_effort)
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO session_desktop_meta
                    (session_id, pinned, archived, last_opened_at, created_at, provider, permission_mode, reasoning_effort)
                VALUES (?, 0, 0, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    last_opened_at = excluded.last_opened_at,
                    provider = excluded.provider,
                    permission_mode = excluded.permission_mode,
                    reasoning_effort = excluded.reasoning_effort
                """,
                (session_id, now, now, provider, mode, effort),
            )
            conn.commit()
        finally:
            conn.close()

    def delete_meta(self, session_id: str) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "DELETE FROM session_desktop_meta WHERE session_id = ?",
                (session_id,),
            )
            conn.commit()
        finally:
            conn.close()

    def set_provider(self, session_id: str, provider: str) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE session_desktop_meta SET provider = ? WHERE session_id = ?",
                (provider, session_id),
            )
            conn.commit()
        finally:
            conn.close()

    def get_providers(self, session_ids: list[str]) -> dict[str, str | None]:
        """Batch lookup provider for multiple sessions.

        Returns a dict mapping session_id to provider (None for missing sessions).
        """
        if not session_ids:
            return {}
        conn = self._connect()
        try:
            placeholders = ",".join("?" for _ in session_ids)
            rows = conn.execute(
                f"SELECT session_id, provider FROM session_desktop_meta WHERE session_id IN ({placeholders})",
                tuple(session_ids),
            ).fetchall()
            result = {sid: None for sid in session_ids}
            for row in rows:
                result[row["session_id"]] = row["provider"]
            return result
        finally:
            conn.close()

    def get_provider(self, session_id: str) -> str | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT provider FROM session_desktop_meta WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            return row["provider"] if row else None
        finally:
            conn.close()

    def set_permission_mode(self, session_id: str, mode: str) -> str:
        value = normalize_permission_mode(mode)
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE session_desktop_meta SET permission_mode = ? WHERE session_id = ?",
                (value, session_id),
            )
            conn.commit()
            return value
        finally:
            conn.close()

    def get_permission_mode(self, session_id: str) -> str:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT permission_mode FROM session_desktop_meta WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if not row:
                return "auto"
            value = str(row["permission_mode"] or "auto").strip().lower()
            return value if value in PERMISSION_MODES else "auto"
        finally:
            conn.close()

    def get_permission_modes(self, session_ids: list[str]) -> dict[str, str]:
        if not session_ids:
            return {}
        conn = self._connect()
        try:
            placeholders = ",".join("?" for _ in session_ids)
            rows = conn.execute(
                f"SELECT session_id, permission_mode FROM session_desktop_meta WHERE session_id IN ({placeholders})",
                tuple(session_ids),
            ).fetchall()
            result = {sid: "auto" for sid in session_ids}
            for row in rows:
                value = str(row["permission_mode"] or "auto").strip().lower()
                result[row["session_id"]] = value if value in PERMISSION_MODES else "auto"
            return result
        finally:
            conn.close()

    def set_reasoning_effort(self, session_id: str, effort: str) -> str:
        value = normalize_reasoning_effort(effort)
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO session_desktop_meta (session_id, reasoning_effort)
                VALUES (?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    reasoning_effort = excluded.reasoning_effort
                """,
                (session_id, value),
            )
            conn.commit()
            return value
        finally:
            conn.close()

    def get_reasoning_effort(self, session_id: str) -> str:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT reasoning_effort FROM session_desktop_meta WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if not row:
                return DEFAULT_REASONING_EFFORT
            return normalize_reasoning_effort(row["reasoning_effort"], strict=False)
        finally:
            conn.close()

    def get_reasoning_efforts(self, session_ids: list[str]) -> dict[str, str]:
        if not session_ids:
            return {}
        conn = self._connect()
        try:
            placeholders = ",".join("?" for _ in session_ids)
            rows = conn.execute(
                f"SELECT session_id, reasoning_effort FROM session_desktop_meta WHERE session_id IN ({placeholders})",
                tuple(session_ids),
            ).fetchall()
            result = {sid: DEFAULT_REASONING_EFFORT for sid in session_ids}
            for row in rows:
                result[row["session_id"]] = normalize_reasoning_effort(
                    row["reasoning_effort"],
                    strict=False,
                )
            return result
        finally:
            conn.close()

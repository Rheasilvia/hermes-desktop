"""DesktopMetaService — wraps db/connection.py for session_desktop_meta CRUD.

Handles all desktop.db session_desktop_meta operations.  Does NOT touch state.db.
"""

from __future__ import annotations

import time
from pathlib import Path


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
                "SELECT session_id, workspace_path, pinned, archived, "
                "last_opened_at, created_at, provider "
                "FROM session_desktop_meta WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_workspace_paths(self, session_ids: list[str]) -> dict[str, str | None]:
        """Batch lookup workspace_path for multiple sessions.

        Returns a dict mapping session_id to workspace_path (None for missing sessions).
        """
        if not session_ids:
            return {}
        conn = self._connect()
        try:
            placeholders = ",".join("?" for _ in session_ids)
            rows = conn.execute(
                f"SELECT session_id, workspace_path FROM session_desktop_meta WHERE session_id IN ({placeholders})",
                tuple(session_ids),
            ).fetchall()
            result = {sid: None for sid in session_ids}
            for row in rows:
                result[row["session_id"]] = row["workspace_path"]
            return result
        finally:
            conn.close()


    def upsert_meta(
        self,
        session_id: str,
        workspace_path: str | None = None,
        provider: str = "",
    ) -> None:
        now = time.time()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO session_desktop_meta
                    (session_id, workspace_path, pinned, archived, last_opened_at, created_at, provider)
                VALUES (?, ?, 0, 0, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    workspace_path = excluded.workspace_path,
                    last_opened_at = excluded.last_opened_at,
                    provider = excluded.provider
                """,
                (session_id, workspace_path, now, now, provider),
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

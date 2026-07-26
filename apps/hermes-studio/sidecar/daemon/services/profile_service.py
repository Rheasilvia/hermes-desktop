"""ProfileService - desktop profile catalog and active-profile resolution.

Profiles are runtime namespaces.  The catalog lives in the default desktop DB,
while each profile keeps its own HERMES_HOME, state.db, desktop.db, config,
secrets, and UI messages.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Any

from ..db.connection import connect, ensure_schema

_PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_ACTIVE_PROFILE_KEY = "active_profile_id"
_PROFILE_COPY_FILES = ("config.yaml", ".env", "SOUL.md", "profile.yaml")
_PROFILE_COPY_DIRS = ("skills", "memories")


class ProfileService:
    """Manage desktop-visible profiles rooted under the default Hermes home."""

    def __init__(self, default_hermes_home: Path) -> None:
        self._default_home = Path(default_hermes_home).expanduser()
        self._profiles_root = self._default_home / "profiles"
        self._ensure_catalog()

    @property
    def default_home(self) -> Path:
        return self._default_home

    def _connect(self) -> sqlite3.Connection:
        conn = connect(self._default_home)
        ensure_schema(conn)
        return conn

    def _ensure_catalog(self) -> None:
        self._default_home.mkdir(parents=True, exist_ok=True)
        self._profiles_root.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            self._upsert_profile_row(
                conn,
                "default",
                name="default",
                home=self._default_home,
                is_default=True,
                archived=False,
            )
            conn.commit()
        finally:
            conn.close()

    def _sync_profile_dirs(self, conn: sqlite3.Connection) -> None:
        self._upsert_profile_row(
            conn,
            "default",
            name="default",
            home=self._default_home,
            is_default=True,
            archived=False,
        )
        if not self._profiles_root.is_dir():
            return
        for entry in sorted(self._profiles_root.iterdir()):
            if not entry.is_dir() or not _PROFILE_ID_RE.match(entry.name):
                continue
            existing = conn.execute(
                "SELECT archived FROM desktop_profiles WHERE id = ?",
                (entry.name,),
            ).fetchone()
            if existing and int(existing["archived"] or 0) == 1:
                continue
            self._upsert_profile_row(
                conn,
                entry.name,
                name=entry.name,
                home=entry,
                is_default=False,
                archived=False,
            )

    def _upsert_profile_row(
        self,
        conn: sqlite3.Connection,
        profile_id: str,
        *,
        name: str,
        home: Path,
        is_default: bool,
        archived: bool,
    ) -> None:
        now = time.time()
        conn.execute(
            """
            INSERT INTO desktop_profiles
                (id, name, hermes_home, is_default, archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                hermes_home = excluded.hermes_home,
                archived = excluded.archived
            """,
            (
                profile_id,
                name,
                str(home),
                1 if is_default else 0,
                1 if archived else 0,
                now,
                now,
            ),
        )

    def normalize_profile_id(self, value: str | None) -> str:
        raw = str(value or "").strip()
        if not raw:
            raise ValueError("profile id cannot be empty")
        if raw.casefold() == "default":
            return "default"
        return raw.lower()

    def validate_profile_id(self, profile_id: str) -> None:
        if profile_id == "default":
            return
        if not _PROFILE_ID_RE.match(profile_id):
            raise ValueError(
                "profile id must match [a-z0-9][a-z0-9_-]{0,63}"
            )

    def _row_to_profile(self, row: sqlite3.Row) -> dict[str, Any]:
        home = Path(str(row["hermes_home"]))
        model, provider = _read_config_model(home)
        return {
            "id": row["id"],
            "name": row["name"],
            "hermesHome": str(home),
            "path": str(home),
            "isDefault": bool(row["is_default"]),
            "archived": bool(row["archived"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "lastUsedAt": row["last_used_at"],
            "model": model,
            "provider": provider,
            "hasEnv": (home / ".env").exists(),
            "skillCount": _count_skills(home),
            "sessionCount": _count_sessions(home),
            "soul": _read_soul(home),
            "setupCommand": "hermes" if row["id"] == "default" else f"hermes --profile {row['id']}",
        }

    def list_profiles(self, *, include_archived: bool = False) -> list[dict[str, Any]]:
        conn = self._connect()
        try:
            self._sync_profile_dirs(conn)
            conn.commit()
            if include_archived:
                rows = conn.execute(
                    "SELECT * FROM desktop_profiles ORDER BY is_default DESC, name COLLATE NOCASE"
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM desktop_profiles
                    WHERE archived = 0
                    ORDER BY is_default DESC, name COLLATE NOCASE
                    """
                ).fetchall()
            return [self._row_to_profile(row) for row in rows]
        finally:
            conn.close()

    def get_profile(self, profile_id: str) -> dict[str, Any]:
        key = self.normalize_profile_id(profile_id)
        self.validate_profile_id(key)
        conn = self._connect()
        try:
            self._sync_profile_dirs(conn)
            row = conn.execute(
                "SELECT * FROM desktop_profiles WHERE id = ? AND archived = 0",
                (key,),
            ).fetchone()
            if row is None:
                raise FileNotFoundError(f"profile not found: {key}")
            return self._row_to_profile(row)
        finally:
            conn.close()

    def get_active_profile_id(self) -> str:
        conn = self._connect()
        try:
            self._sync_profile_dirs(conn)
            row = conn.execute(
                "SELECT value FROM desktop_state WHERE key = ?",
                (_ACTIVE_PROFILE_KEY,),
            ).fetchone()
            profile_id = str(row["value"]).strip() if row else "default"
            if not profile_id:
                return "default"
            exists = conn.execute(
                "SELECT 1 FROM desktop_profiles WHERE id = ? AND archived = 0",
                (profile_id,),
            ).fetchone()
            return profile_id if exists else "default"
        finally:
            conn.close()

    def get_active_profile(self) -> dict[str, Any]:
        return self.get_profile(self.get_active_profile_id())

    def get_active_hermes_home(self) -> Path:
        return Path(self.get_active_profile()["hermesHome"])

    def set_active_profile(self, profile_id: str) -> dict[str, Any]:
        profile = self.get_profile(profile_id)
        conn = self._connect()
        try:
            now = time.time()
            conn.execute(
                """
                INSERT INTO desktop_state (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (_ACTIVE_PROFILE_KEY, profile["id"]),
            )
            conn.execute(
                "UPDATE desktop_profiles SET last_used_at = ?, updated_at = ? WHERE id = ?",
                (now, now, profile["id"]),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_profile(profile["id"])

    def create_profile(
        self,
        *,
        name: str,
        clone_from: str | None = None,
        soul: str | None = None,
    ) -> dict[str, Any]:
        profile_id = self.normalize_profile_id(name)
        self.validate_profile_id(profile_id)
        if profile_id == "default":
            raise ValueError("default profile already exists")
        home = self._profiles_root / profile_id
        if home.exists():
            raise FileExistsError(f"profile already exists: {profile_id}")
        home.mkdir(parents=True, exist_ok=False)
        for subdir in ("sessions", "skills", "memories", "logs", "desktop"):
            (home / subdir).mkdir(parents=True, exist_ok=True)

        source_home = None
        if clone_from:
            source_home = Path(self.get_profile(clone_from)["hermesHome"])
        if source_home:
            for filename in _PROFILE_COPY_FILES:
                src = source_home / filename
                if src.exists():
                    shutil.copy2(src, home / filename)
                    if filename == ".env":
                        _chmod_owner_only(home / filename)
            for dirname in _PROFILE_COPY_DIRS:
                src_dir = source_home / dirname
                if src_dir.is_dir():
                    shutil.copytree(src_dir, home / dirname, dirs_exist_ok=True)

        env_path = home / ".env"
        if not env_path.exists():
            env_path.write_text(
                "# Per-profile secrets for this Hermes profile.\n"
                "# Behavioral settings belong in config.yaml.\n",
                encoding="utf-8",
            )
            _chmod_owner_only(env_path)

        soul_path = home / "SOUL.md"
        if soul is not None:
            soul_path.write_text(soul, encoding="utf-8")
        elif not soul_path.exists():
            try:
                from hermes_cli.default_soul import DEFAULT_SOUL_MD
                soul_path.write_text(DEFAULT_SOUL_MD, encoding="utf-8")
            except Exception:
                soul_path.write_text("", encoding="utf-8")

        conn = self._connect()
        try:
            self._upsert_profile_row(
                conn,
                profile_id,
                name=profile_id,
                home=home,
                is_default=False,
                archived=False,
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_profile(profile_id)

    def update_profile(
        self,
        profile_id: str,
        *,
        name: str | None = None,
        soul: str | None = None,
        is_default: bool | None = None,
    ) -> dict[str, Any]:
        profile = self.get_profile(profile_id)
        conn = self._connect()
        try:
            now = time.time()
            if name is not None:
                display_name = name.strip()
                if not display_name:
                    raise ValueError("profile name cannot be empty")
                conn.execute(
                    "UPDATE desktop_profiles SET name = ?, updated_at = ? WHERE id = ?",
                    (display_name, now, profile["id"]),
                )
            if is_default is True:
                conn.execute("UPDATE desktop_profiles SET is_default = 0")
                conn.execute(
                    "UPDATE desktop_profiles SET is_default = 1, updated_at = ? WHERE id = ?",
                    (now, profile["id"]),
                )
            conn.commit()
        finally:
            conn.close()
        if soul is not None:
            _write_soul(Path(profile["hermesHome"]), soul)
        return self.get_profile(profile["id"])

    def archive_profile(self, profile_id: str) -> None:
        profile = self.get_profile(profile_id)
        if profile["id"] == "default":
            raise ValueError("default profile cannot be removed")
        conn = self._connect()
        try:
            now = time.time()
            conn.execute(
                "UPDATE desktop_profiles SET archived = 1, updated_at = ? WHERE id = ?",
                (now, profile["id"]),
            )
            if self.get_active_profile_id() == profile["id"]:
                conn.execute(
                    """
                    INSERT INTO desktop_state (key, value)
                    VALUES (?, 'default')
                    ON CONFLICT(key) DO UPDATE SET value = 'default'
                    """,
                    (_ACTIVE_PROFILE_KEY,),
                )
            if profile["isDefault"]:
                conn.execute("UPDATE desktop_profiles SET is_default = 0")
                conn.execute(
                    "UPDATE desktop_profiles SET is_default = 1, updated_at = ? WHERE id = 'default'",
                    (now,),
                )
            conn.commit()
        finally:
            conn.close()

    def get_profile_state(self, profile_id: str, key: str) -> Any:
        profile = self.get_profile(profile_id)
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT value_json FROM desktop_profile_state WHERE profile_id = ? AND key = ?",
                (profile["id"], key),
            ).fetchone()
            if not row:
                return None
            return json.loads(row["value_json"])
        finally:
            conn.close()

    def set_profile_state(self, profile_id: str, key: str, value: Any) -> None:
        profile = self.get_profile(profile_id)
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO desktop_profile_state (profile_id, key, value_json)
                VALUES (?, ?, ?)
                ON CONFLICT(profile_id, key) DO UPDATE SET value_json = excluded.value_json
                """,
                (profile["id"], key, json.dumps(value)),
            )
            conn.commit()
        finally:
            conn.close()

    def list_profile_sessions(
        self,
        *,
        profile: str,
        archived: str = "exclude",
    ) -> dict[str, Any]:
        profiles = self.list_profiles()
        if profile == "current":
            active = self.get_active_profile_id()
            profiles = [p for p in profiles if p["id"] == active]
        elif profile != "all":
            profiles = [self.get_profile(profile)]

        sessions: list[dict[str, Any]] = []
        profile_totals: dict[str, int] = {}
        for prof in profiles:
            try:
                rows = _list_sessions_for_home(Path(prof["hermesHome"]), archived=archived)
            except Exception:
                rows = []
            profile_totals[prof["id"]] = len(rows)
            for row in rows:
                row["profileId"] = prof["id"]
                row["profileName"] = prof["name"]
            sessions.extend(rows)

        sessions.sort(key=lambda row: row.get("last_active") or row.get("started_at") or 0, reverse=True)
        return {
            "sessions": sessions,
            "total": len(sessions),
            "profileTotals": profile_totals,
        }


def _read_config_model(home: Path) -> tuple[str | None, str | None]:
    path = home / "config.yaml"
    if not path.exists():
        return None, None
    try:
        import yaml
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        model_cfg = data.get("model", {}) if isinstance(data, dict) else {}
        if isinstance(model_cfg, str):
            return model_cfg, None
        if isinstance(model_cfg, dict):
            return model_cfg.get("default") or model_cfg.get("model"), model_cfg.get("provider")
    except Exception:
        return None, None
    return None, None


def _count_skills(home: Path) -> int:
    skills = home / "skills"
    if not skills.is_dir():
        return 0
    return sum(1 for path in skills.rglob("SKILL.md") if path.is_file())


def _count_sessions(home: Path) -> int:
    db_path = home / "state.db"
    if not db_path.exists():
        return 0
    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE source = 'desktop'"
        ).fetchone()
        return int(row[0] or 0)
    except sqlite3.Error:
        return 0
    finally:
        conn.close()


def _read_soul(home: Path) -> str:
    path = home / "SOUL.md"
    try:
        return path.read_text(encoding="utf-8") if path.exists() else ""
    except OSError:
        return ""


def _write_soul(home: Path, content: str) -> None:
    path = home / "SOUL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _chmod_owner_only(path: Path) -> None:
    try:
        os.chmod(str(path), 0o600)
    except OSError:
        pass


def _list_sessions_for_home(home: Path, *, archived: str) -> list[dict[str, Any]]:
    from .desktop_meta_service import DesktopMetaService
    from .session_service import SessionService
    from .session_state_service import SessionStateService
    from hermes_state import SessionDB

    svc = SessionService(
        hermes_home=home,
        state=SessionStateService(SessionDB(home / "state.db")),
        meta=DesktopMetaService(home),
    )
    return svc.list_sessions(archived=archived)

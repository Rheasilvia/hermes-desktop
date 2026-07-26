"""Layer 2 overlay loader backed by SQLite."""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

from ..db.connection import connect, ensure_schema

log = logging.getLogger(__name__)

DOMAIN_TABLE = {"model": "model_overlays", "cron": "cron_overlays"}
DOMAIN_ID_COL = {"model": "provider_id", "cron": "job_id"}

# Schema is ensured once per process per DB path. We do NOT cache the
# connection itself: SQLite connections are bound to the thread that created
# them, and the daemon serves requests across multiple threads (anyio workers,
# agent-turn threads). A shared connection raises "SQLite objects created in a
# thread can only be used in that same thread". So each call opens its own
# short-lived connection (cheap) and only the redundant schema migration is
# skipped after the first time.
_ensured_paths: set[str] = set()
_ensure_lock = threading.Lock()


def _open(hermes_home: Path):
    """Open a fresh per-call connection, ensuring schema once per process."""
    conn = connect(hermes_home)
    key = str(hermes_home)
    with _ensure_lock:
        if key not in _ensured_paths:
            ensure_schema(conn)
            _ensured_paths.add(key)
    return conn


def load(hermes_home: Path, domain: str) -> dict[str, dict[str, Any]]:
    table = DOMAIN_TABLE.get(domain)
    if table is None:
        return {}
    conn = _open(hermes_home)
    try:
        rows = conn.execute(f"SELECT * FROM {table}").fetchall()
    finally:
        conn.close()

    result: dict[str, dict[str, Any]] = {}
    id_col = DOMAIN_ID_COL[domain]
    for row in rows:
        entry = dict(row)
        entity_id = entry.pop(id_col, None)
        if entity_id is not None:
            result[entity_id] = {k: v for k, v in entry.items() if v is not None}
    return result


def update(
    hermes_home: Path,
    domain: str,
    entity_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    table = DOMAIN_TABLE.get(domain)
    if table is None:
        raise ValueError(f"Unknown overlay domain: {domain}")
    id_col = DOMAIN_ID_COL[domain]

    conn = _open(hermes_home)
    try:
        row = conn.execute(
            f"SELECT * FROM {table} WHERE {id_col} = ?", (entity_id,)
        ).fetchone()

        current: dict[str, Any] = {}
        if row:
            current = dict(row)
            current.pop(id_col, None)

        current.update(patch)
        current = {k: v for k, v in current.items() if v is not None}

        cols = [id_col]
        vals = [entity_id]
        for key, val in current.items():
            cols.append(key)
            vals.append(val)

        placeholders = ", ".join(["?"] * len(vals))
        col_names = ", ".join(cols)
        conn.execute(
            f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})",
            vals,
        )
        conn.commit()
    finally:
        conn.close()

    return {**current}


def delete(hermes_home: Path, domain: str, entity_id: str) -> None:
    table = DOMAIN_TABLE.get(domain)
    if table is None:
        raise ValueError(f"Unknown overlay domain: {domain}")
    id_col = DOMAIN_ID_COL[domain]

    conn = _open(hermes_home)
    try:
        conn.execute(f"DELETE FROM {table} WHERE {id_col} = ?", (entity_id,))
        conn.commit()
    finally:
        conn.close()

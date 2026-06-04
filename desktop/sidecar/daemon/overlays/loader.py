"""Layer 2 overlay loader backed by SQLite (v3)."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from ..db.connection import connect, ensure_schema

log = logging.getLogger(__name__)

DOMAIN_TABLE = {"model": "model_overlays", "cron": "cron_overlays"}
DOMAIN_ID_COL = {"model": "provider_id", "cron": "job_id"}


def load(hermes_home: Path, domain: str) -> dict[str, dict[str, Any]]:
    table = DOMAIN_TABLE.get(domain)
    if table is None:
        return {}
    conn = connect(hermes_home)
    ensure_schema(conn)
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

    conn = connect(hermes_home)
    ensure_schema(conn)
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

    conn = connect(hermes_home)
    ensure_schema(conn)
    try:
        conn.execute(f"DELETE FROM {table} WHERE {id_col} = ?", (entity_id,))
        conn.commit()
    finally:
        conn.close()

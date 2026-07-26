import sqlite3
import time
from pathlib import Path

_NOW = time.time()


def _seed_db(path: Path):
    conn = sqlite3.connect(str(path))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            billing_provider TEXT,
            model TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            estimated_cost_usd REAL DEFAULT 0,
            actual_cost_usd REAL,
            started_at REAL NOT NULL
        )
    """)
    # 5 days ago — outside any reasonable short window
    conn.execute(
        """
        INSERT INTO sessions (
            id, source, billing_provider, model, input_tokens, output_tokens,
            estimated_cost_usd, actual_cost_usd, started_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
        """,
        ("s1", "desktop", "anthropic", "claude-sonnet-4-6", 1000, 500, 0.015, None, _NOW - 5 * 86400),
    )
    # 2 days ago — outside days=1 window, inside days=30 window
    conn.execute(
        """
        INSERT INTO sessions (
            id, source, billing_provider, model, input_tokens, output_tokens,
            estimated_cost_usd, actual_cost_usd, started_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
        """,
        ("s2", "desktop", "anthropic", "claude-opus-4-7", 800, 400, 0.048, None, _NOW - 2 * 86400),
    )
    # Recent (today) — inside days=1 window
    conn.execute(
        """
        INSERT INTO sessions (
            id, source, billing_provider, model, input_tokens, output_tokens,
            estimated_cost_usd, actual_cost_usd, started_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
        """,
        ("s3", "desktop", "anthropic", "claude-haiku-4-5", 200, 100, 0.003, None, _NOW - 3600),
    )
    conn.commit()
    conn.close()


def test_analytics_returns_stats(client, auth, hermes_home):
    db_path = hermes_home / "state.db"
    _seed_db(db_path)

    resp = client.get("/desktop/api/analytics/models?days=30", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert "models" in body
    assert "totals" in body
    assert len(body["models"]) == 3
    names = {m["model"] for m in body["models"]}
    assert "claude-sonnet-4-6" in names


def test_analytics_missing_db_returns_empty(client, auth, hermes_home):
    resp = client.get("/desktop/api/analytics/models?days=30", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert body["models"] == []
    assert body["totals"]["total_sessions"] == 0


def test_analytics_requires_auth(client):
    resp = client.get("/desktop/api/analytics/models")
    assert resp.status_code == 401


def test_analytics_days_filter(client, auth, hermes_home):
    db_path = hermes_home / "state.db"
    _seed_db(db_path)
    # days=1 should only include sessions from the last 1 day
    resp = client.get("/desktop/api/analytics/models?days=1", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    models = {m["model"] for m in body["models"]}
    # 5-day-old and 2-day-old records should be excluded
    assert "claude-sonnet-4-6" not in models
    assert "claude-opus-4-7" not in models
    # Recent record (1 hour ago) should be included
    assert "claude-haiku-4-5" in models


def test_analytics_invalid_days(client, auth):
    for bad in (0, -1, -30):
        resp = client.get(f"/desktop/api/analytics/models?days={bad}", headers=auth)
        assert resp.status_code == 400, f"days={bad} should be 400, got {resp.status_code}"

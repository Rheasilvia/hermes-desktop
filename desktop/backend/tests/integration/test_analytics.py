import sqlite3
from pathlib import Path


def _seed_db(path: Path):
    conn = sqlite3.connect(str(path))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            provider TEXT,
            model TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cost_usd REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    # 5 days ago — outside any reasonable short window
    conn.execute(
        "INSERT INTO sessions VALUES (?,?,?,?,?,?,datetime('now','-5 days'))",
        ("s1", "anthropic", "claude-sonnet-4-6", 1000, 500, 0.015),
    )
    # 2 days ago — outside days=1 window, inside days=30 window
    conn.execute(
        "INSERT INTO sessions VALUES (?,?,?,?,?,?,datetime('now','-2 days'))",
        ("s2", "anthropic", "claude-opus-4-7", 800, 400, 0.048),
    )
    # Recent (today) — inside days=1 window
    conn.execute(
        "INSERT INTO sessions VALUES (?,?,?,?,?,?,datetime('now','-1 hours'))",
        ("s3", "anthropic", "claude-haiku-4-5", 200, 100, 0.003),
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
        assert resp.status_code == 422, f"days={bad} should be 422, got {resp.status_code}"

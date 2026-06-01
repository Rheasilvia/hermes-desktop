from __future__ import annotations


def test_commands_catalog_includes_registry_commands(client, auth):
    r = client.get("/desktop/api/commands/catalog", headers=auth)

    assert r.status_code == 200
    items = r.json()["items"]
    by_name = {item["command"]: item for item in items}
    assert "help" in by_name
    assert by_name["help"]["supported"] is True
    assert "mouse" in by_name
    assert by_name["mouse"]["supported"] is False


def test_complete_slash_filters_by_partial(client, auth):
    r = client.post(
        "/desktop/api/commands/complete/slash",
        json={"partial": "/mo"},
        headers=auth,
    )

    assert r.status_code == 200
    commands = [item["command"] for item in r.json()["items"]]
    assert "model" in commands


def test_slash_exec_help_returns_output(client, auth):
    created = client.post("/desktop/api/sessions", json={}, headers=auth)
    sid = created.json()["session_id"]

    r = client.post(
        "/desktop/api/commands/slash/exec",
        json={"session_id": sid, "command": "help", "raw": "/help"},
        headers=auth,
    )

    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "output"
    assert "Available slash commands" in body["message"]


def test_slash_exec_alias_queue_returns_send(client, auth):
    created = client.post("/desktop/api/sessions", json={}, headers=auth)
    sid = created.json()["session_id"]

    r = client.post(
        "/desktop/api/commands/slash/exec",
        json={"session_id": sid, "command": "q", "args": "next prompt", "raw": "/q next prompt"},
        headers=auth,
    )

    assert r.status_code == 200
    assert r.json() == {"kind": "send", "message": "next prompt"}


def test_slash_exec_terminal_only_returns_unsupported(client, auth):
    created = client.post("/desktop/api/sessions", json={}, headers=auth)
    sid = created.json()["session_id"]

    r = client.post(
        "/desktop/api/commands/slash/exec",
        json={"session_id": sid, "command": "mouse", "raw": "/mouse"},
        headers=auth,
    )

    assert r.status_code == 200
    assert r.json()["kind"] == "unsupported"


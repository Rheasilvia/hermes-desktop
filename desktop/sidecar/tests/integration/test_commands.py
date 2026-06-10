from __future__ import annotations


def test_commands_catalog_includes_registry_commands(client, auth):
    r = client.get("/desktop/api/commands/catalog", headers=auth)

    assert r.status_code == 200
    items = r.json()["items"]
    by_name = {item["command"]: item for item in items}
    assert "help" in by_name
    assert by_name["help"]["supported"] is False
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
    assert "model" not in commands


def test_complete_path_requires_session_id(client, auth, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    r = client.post(
        "/desktop/api/commands/complete/path",
        json={"word": "@my", "cwd": str(workspace)},
        headers=auth,
    )

    assert r.status_code == 400
    assert r.json()["detail"] == "SESSION_REQUIRED"


def test_complete_path_fuzzy_file_candidates(client, auth, workspace_grant, tmp_path):
    workspace = tmp_path / "workspace"
    docs = workspace / "docs"
    docs.mkdir(parents=True)
    (docs / "mydoc.txt").write_text("hello", encoding="utf-8")
    created = client.post(
        "/desktop/api/sessions",
        json={"cwd": str(workspace)},
        headers=workspace_grant,
    )
    sid = created.json()["session_id"]

    r = client.post(
        "/desktop/api/commands/complete/path",
        json={"word": "@my", "session_id": sid},
        headers=auth,
    )

    assert r.status_code == 200
    assert r.json()["items"] == [
        {"text": "@file:docs/mydoc.txt", "display": "mydoc.txt", "meta": "docs"}
    ]


def test_complete_path_honors_file_and_folder_prefixes(client, auth, workspace_grant, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "docs").mkdir()
    (workspace / "docs.txt").write_text("hello", encoding="utf-8")
    created = client.post(
        "/desktop/api/sessions",
        json={"cwd": str(workspace)},
        headers=workspace_grant,
    )
    sid = created.json()["session_id"]

    folder_resp = client.post(
        "/desktop/api/commands/complete/path",
        json={"word": "@folder:d", "session_id": sid},
        headers=auth,
    )
    file_resp = client.post(
        "/desktop/api/commands/complete/path",
        json={"word": "@file:d", "session_id": sid},
        headers=auth,
    )

    assert folder_resp.status_code == 200
    assert "@folder:docs/" in [item["text"] for item in folder_resp.json()["items"]]
    assert "@folder:docs.txt" not in [item["text"] for item in folder_resp.json()["items"]]

    assert file_resp.status_code == 200
    assert "@file:docs.txt" in [item["text"] for item in file_resp.json()["items"]]
    assert "@file:docs/" not in [item["text"] for item in file_resp.json()["items"]]


def test_complete_path_uses_session_cwd_and_ignores_request_cwd(client, auth, workspace_grant, tmp_path):
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (workspace / "notes.md").write_text("hello", encoding="utf-8")
    (outside / "secret.md").write_text("nope", encoding="utf-8")
    created = client.post(
        "/desktop/api/sessions",
        json={"cwd": str(workspace)},
        headers=workspace_grant,
    )
    sid = created.json()["session_id"]

    r = client.post(
        "/desktop/api/commands/complete/path",
        json={"word": "@se", "session_id": sid, "cwd": str(outside)},
        headers=auth,
    )

    assert r.status_code == 200
    assert r.json()["items"] == []


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
    assert body["kind"] == "unsupported"
    assert body["message"] == "/help is not available in Desktop."


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

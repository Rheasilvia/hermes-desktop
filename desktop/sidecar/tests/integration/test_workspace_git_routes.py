from __future__ import annotations

from pathlib import Path
import subprocess


def _create_session(client, workspace_grant, workspace):
    response = client.post(
        "/desktop/api/sessions",
        json={"cwd": str(workspace)},
        headers=workspace_grant,
    )
    assert response.status_code == 200
    return response.json()["session_id"]


def test_workspace_children_are_session_scoped(client, auth, workspace_grant, tmp_path):
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (workspace / "inside.txt").write_text("ok", encoding="utf-8")
    (outside / "secret.txt").write_text("nope", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)

    ok = client.get(
        f"/desktop/api/sessions/{sid}/workspace/children",
        params={"path": "."},
        headers=auth,
    )
    denied = client.get(
        f"/desktop/api/sessions/{sid}/workspace/children",
        params={"path": str(outside)},
        headers=auth,
    )

    assert ok.status_code == 200
    assert [item["name"] for item in ok.json()["children"]] == ["inside.txt"]
    assert denied.status_code == 403
    assert "escapes workspace root" in denied.json()["detail"]


def test_workspace_file_rejects_symlink_escape(client, auth, workspace_grant, tmp_path):
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (outside / "secret.txt").write_text("nope", encoding="utf-8")
    (workspace / "link").symlink_to(outside, target_is_directory=True)
    sid = _create_session(client, workspace_grant, workspace)

    response = client.get(
        f"/desktop/api/sessions/{sid}/workspace/file",
        params={"path": "link/secret.txt"},
        headers=auth,
    )

    assert response.status_code == 403
    assert "escapes workspace root" in response.json()["detail"]


def test_workspace_file_preview_reads_only_bounded_bytes(client, auth, workspace_grant, tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    large_file = workspace / "large.txt"
    large_file.write_text(("a" * (100 * 1024)) + "tail", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)

    def fail_read_bytes(_self):
        raise AssertionError("workspace preview must not read the entire file")

    monkeypatch.setattr(Path, "read_bytes", fail_read_bytes)

    response = client.get(
        f"/desktop/api/sessions/{sid}/workspace/file",
        params={"path": "large.txt"},
        headers=auth,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["truncated"] is True
    assert body["binary"] is False
    assert len(body["content"]) == 100 * 1024


def test_workspace_file_write_uses_mtime_size_guard_and_reads_back(client, auth, workspace_grant, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    target = workspace / "editable.txt"
    target.write_text("old\n", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)
    current = client.get(
        f"/desktop/api/sessions/{sid}/workspace/file",
        params={"path": "editable.txt"},
        headers=auth,
    ).json()

    written = client.put(
        f"/desktop/api/sessions/{sid}/workspace/file",
        json={
            "path": "editable.txt",
            "content": "new\n",
            "expected_mtime": current["mtime"],
            "expected_size": current["size"],
        },
        headers=auth,
    )
    stale = client.put(
        f"/desktop/api/sessions/{sid}/workspace/file",
        json={
            "path": "editable.txt",
            "content": "stale\n",
            "expected_mtime": current["mtime"],
            "expected_size": current["size"],
        },
        headers=auth,
    )

    assert written.status_code == 200
    assert written.json()["content"] == "new\n"
    assert target.read_text(encoding="utf-8") == "new\n"
    assert stale.status_code == 409
    assert stale.json()["detail"] == "WORKSPACE_FILE_CHANGED"


def test_workspace_reveal_rejects_absolute_escape(client, auth, workspace_grant, tmp_path):
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    secret = outside / "secret.txt"
    secret.write_text("nope", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)

    response = client.post(
        f"/desktop/api/sessions/{sid}/workspace/reveal",
        json={"path": str(secret)},
        headers=auth,
    )

    assert response.status_code == 403
    assert "escapes workspace root" in response.json()["detail"]


def test_git_diff_uses_session_workspace(client, auth, workspace_grant, tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
    (workspace / "tracked.txt").write_text("old\n", encoding="utf-8")
    subprocess.run(["git", "add", "tracked.txt"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"],
        cwd=workspace,
        check=True,
        capture_output=True,
    )
    (workspace / "tracked.txt").write_text("new\n", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)

    response = client.get(f"/desktop/api/sessions/{sid}/git/diff", headers=auth)

    assert response.status_code == 200
    body = response.json()
    assert body["working_dir"] == str(workspace)
    assert body["summary"]["files_changed"] == 1


def test_git_diff_disables_textconv_commands(client, auth, workspace_grant, tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    marker = tmp_path / "outside-marker"
    workspace.mkdir()
    subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=workspace, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=workspace, check=True)
    (workspace / ".gitattributes").write_text("*.pwn diff=pwn\n", encoding="utf-8")
    (workspace / "sample.pwn").write_text("old\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "diff.pwn.textconv", f"sh -c 'echo ran > {marker}; cat \"$1\"' -"],
        cwd=workspace,
        check=True,
    )
    (workspace / "sample.pwn").write_text("new\n", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)

    response = client.get(f"/desktop/api/sessions/{sid}/git/diff", headers=auth)

    assert response.status_code == 200
    # --no-textconv is always passed, so a malicious textconv never runs even
    # though the user-path git call is no longer sandboxed.
    assert marker.exists() is False


def test_git_checkout_rejects_branch_not_in_local_refs(client, auth, workspace_grant, tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
    sid = _create_session(client, workspace_grant, workspace)

    response = client.post(
        f"/desktop/api/sessions/{sid}/git/checkout",
        json={"branch": "main;touch /tmp/pwned"},
        headers=auth,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "BRANCH_NOT_FOUND"


def test_git_checkout_is_not_gated_by_agent_sandbox_mode(client, auth, workspace_grant, tmp_path):
    # A user-initiated Git-panel checkout must NOT be blocked by the agent
    # sandbox's read-only mode. That knob constrains agent tool calls, not
    # explicit user actions in the UI.
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
    (workspace / "a.txt").write_text("a\n", encoding="utf-8")
    subprocess.run(["git", "add", "a.txt"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=t@e.com", "commit", "-m", "init"],
        cwd=workspace, check=True, capture_output=True,
    )
    subprocess.run(["git", "checkout", "-b", "feature"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "checkout", "master"], cwd=workspace, check=True, capture_output=True)
    sid = _create_session(client, workspace_grant, workspace)
    settings = client.get("/desktop/api/settings", headers=auth).json()
    settings["desktop_sandbox"] = {"mode": "read-only", "network_access": "restricted"}
    response = client.put("/desktop/api/settings", json=settings, headers=auth)
    assert response.status_code == 200

    response = client.post(
        f"/desktop/api/sessions/{sid}/git/checkout",
        json={"branch": "feature"},
        headers=auth,
    )

    assert response.status_code == 200


def test_git_checkout_runs_without_sandbox_runner(client, auth, workspace_grant, tmp_path, monkeypatch):
    # User-initiated checkout runs outside the sandbox; it must not require a
    # sandbox runner to be present.
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
    (workspace / "a.txt").write_text("a\n", encoding="utf-8")
    subprocess.run(["git", "add", "a.txt"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=t@e.com", "commit", "-m", "init"],
        cwd=workspace, check=True, capture_output=True,
    )
    subprocess.run(["git", "checkout", "-b", "feature"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "checkout", "master"], cwd=workspace, check=True, capture_output=True)
    sid = _create_session(client, workspace_grant, workspace)
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: None)

    response = client.post(
        f"/desktop/api/sessions/{sid}/git/checkout",
        json={"branch": "feature"},
        headers=auth,
    )

    assert response.status_code == 200

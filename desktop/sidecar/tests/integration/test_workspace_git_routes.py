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


def test_git_diff_uses_session_workspace(client, auth, workspace_grant, tmp_path):
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


def test_git_checkout_rejects_branch_not_in_local_refs(client, auth, workspace_grant, tmp_path):
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


def test_git_checkout_fails_closed_without_sandbox(client, auth, workspace_grant, tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "checkout", "-b", "feature"], cwd=workspace, check=True, capture_output=True)
    sid = _create_session(client, workspace_grant, workspace)
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: None)

    response = client.post(
        f"/desktop/api/sessions/{sid}/git/checkout",
        json={"branch": "feature"},
        headers=auth,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "SANDBOX_UNAVAILABLE"

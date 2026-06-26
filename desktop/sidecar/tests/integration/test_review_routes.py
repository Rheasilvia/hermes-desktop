from __future__ import annotations

from pathlib import Path
import subprocess


class _RawGitRunner:
    def __init__(self) -> None:
        self.calls = []

    def run(self, **kwargs):
        self.calls.append(kwargs)
        return subprocess.run(
            kwargs["command"],
            cwd=kwargs["cwd"],
            env=kwargs["env"],
            timeout=kwargs["timeout"],
            capture_output=True,
            text=True,
            check=False,
        )


def _create_session(client, workspace_grant, workspace: Path) -> str:
    response = client.post(
        "/desktop/api/sessions",
        json={"cwd": str(workspace)},
        headers=workspace_grant,
    )
    assert response.status_code == 200
    return response.json()["session_id"]


def _run_git(workspace: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=workspace, check=True, capture_output=True, text=True)


def _init_repo(workspace: Path) -> None:
    workspace.mkdir()
    _run_git(workspace, "init")
    _run_git(workspace, "config", "user.name", "Test User")
    _run_git(workspace, "config", "user.email", "test@example.com")
    (workspace / "tracked.txt").write_text("old\n", encoding="utf-8")
    _run_git(workspace, "add", "tracked.txt")
    _run_git(workspace, "commit", "-m", "init")


def test_review_files_reports_staged_unstaged_untracked_with_churn(
    client,
    auth,
    workspace_grant,
    tmp_path,
    monkeypatch,
):
    workspace = tmp_path / "workspace"
    _init_repo(workspace)
    (workspace / "tracked.txt").write_text("old\nnew\n", encoding="utf-8")
    (workspace / "staged.txt").write_text("staged\n", encoding="utf-8")
    _run_git(workspace, "add", "staged.txt")
    (workspace / "notes.txt").write_text("one\ntwo\n", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: _RawGitRunner())

    response = client.get(f"/desktop/api/sessions/{sid}/review/files", headers=auth)

    assert response.status_code == 200
    body = response.json()
    files = {item["path"]: item for item in body["files"]}
    assert body["working_dir"] == str(workspace)
    assert body["summary"]["staged_count"] == 1
    assert body["summary"]["unstaged_count"] == 1
    assert body["summary"]["untracked_count"] == 1
    assert files["tracked.txt"]["unstaged"] is True
    assert files["staged.txt"]["staged"] is True
    assert files["notes.txt"]["untracked"] is True
    assert files["notes.txt"]["insertions"] == 2


def test_review_diff_returns_untracked_file_as_all_add_diff(
    client,
    auth,
    workspace_grant,
    tmp_path,
    monkeypatch,
):
    workspace = tmp_path / "workspace"
    _init_repo(workspace)
    (workspace / "new.txt").write_text("alpha\nbeta\n", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: _RawGitRunner())

    response = client.post(
        f"/desktop/api/sessions/{sid}/review/diff",
        json={"path": "new.txt", "staged": False},
        headers=auth,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["files"][0]["path"] == "new.txt"
    assert body["files"][0]["status"] == "added"
    lines = body["files"][0]["hunks"][0]["lines"]
    assert [line["kind"] for line in lines] == ["addition", "addition"]
    assert [line["content"] for line in lines] == ["alpha", "beta"]
    assert body["summary"] == {"files_changed": 1, "insertions": 2, "deletions": 0}


def test_review_stage_unstage_and_commit_refreshes_git_state(
    client,
    auth,
    workspace_grant,
    tmp_path,
    monkeypatch,
):
    workspace = tmp_path / "workspace"
    _init_repo(workspace)
    (workspace / "tracked.txt").write_text("old\nnext\n", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)
    runner = _RawGitRunner()
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: runner)

    stage = client.post(
        f"/desktop/api/sessions/{sid}/review/stage",
        json={"paths": ["tracked.txt"]},
        headers=auth,
    )
    staged = client.get(f"/desktop/api/sessions/{sid}/review/files", headers=auth)
    unstage = client.post(
        f"/desktop/api/sessions/{sid}/review/unstage",
        json={"paths": ["tracked.txt"]},
        headers=auth,
    )
    unstaged = client.get(f"/desktop/api/sessions/{sid}/review/files", headers=auth)
    client.post(
        f"/desktop/api/sessions/{sid}/review/stage",
        json={"paths": ["tracked.txt"]},
        headers=auth,
    )
    commit = client.post(
        f"/desktop/api/sessions/{sid}/review/commit",
        json={"message": "Update tracked file"},
        headers=auth,
    )

    assert stage.status_code == 200
    assert staged.json()["summary"]["staged_count"] == 1
    assert unstage.status_code == 200
    assert unstaged.json()["summary"]["staged_count"] == 0
    assert commit.status_code == 200
    assert commit.json()["ok"] is True
    clean = client.get(f"/desktop/api/sessions/{sid}/review/files", headers=auth)
    assert clean.json()["summary"]["files_changed"] == 0
    assert any("add" in call["command"] for call in runner.calls)
    assert any("commit" in call["command"] for call in runner.calls)


def test_review_mutations_reject_read_only_sandbox(
    client,
    auth,
    workspace_grant,
    tmp_path,
):
    workspace = tmp_path / "workspace"
    _init_repo(workspace)
    (workspace / "tracked.txt").write_text("changed\n", encoding="utf-8")
    sid = _create_session(client, workspace_grant, workspace)
    settings = client.get("/desktop/api/settings", headers=auth).json()
    settings["desktop_sandbox"] = {"mode": "read-only", "network_access": "restricted"}
    saved = client.put("/desktop/api/settings", json=settings, headers=auth)
    assert saved.status_code == 200

    response = client.post(
        f"/desktop/api/sessions/{sid}/review/stage",
        json={"paths": ["tracked.txt"]},
        headers=auth,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "SANDBOX_READ_ONLY"


def test_review_files_returns_empty_state_for_non_repo(client, auth, workspace_grant, tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sid = _create_session(client, workspace_grant, workspace)
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: _RawGitRunner())

    response = client.get(f"/desktop/api/sessions/{sid}/review/files", headers=auth)

    assert response.status_code == 200
    body = response.json()
    assert body["working_dir"] == str(workspace)
    assert body["branch"] == ""
    assert body["files"] == []
    assert body["summary"]["files_changed"] == 0


def test_review_commit_message_no_diff_does_not_mutate_chat(
    client,
    auth,
    workspace_grant,
    tmp_path,
    monkeypatch,
):
    workspace = tmp_path / "workspace"
    _init_repo(workspace)
    sid = _create_session(client, workspace_grant, workspace)
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: _RawGitRunner())

    response = client.post(
        f"/desktop/api/sessions/{sid}/review/commit-message",
        json={},
        headers=auth,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failed"
    assert body["message"] is None
    assert body["detail"] == "NO_DIFF"

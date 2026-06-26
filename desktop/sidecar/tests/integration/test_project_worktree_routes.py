from __future__ import annotations

from pathlib import Path
import subprocess


class _RawGitRunner:
    def run(self, **kwargs):
        return subprocess.run(
            kwargs["command"],
            cwd=kwargs["cwd"],
            env=kwargs["env"],
            timeout=kwargs["timeout"],
            capture_output=True,
            text=True,
            check=False,
        )


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
    _run_git(workspace, "branch", "-M", "main")


def test_projects_persist_and_active_project_round_trips(client, auth, tmp_path):
    workspace = tmp_path / "repo"
    workspace.mkdir()

    created = client.post(
        "/desktop/api/projects",
        json={"path": str(workspace), "name": "Repo"},
        headers=auth,
    )
    active = client.put(
        "/desktop/api/projects/active",
        json={"path": str(workspace)},
        headers=auth,
    )
    listed = client.get("/desktop/api/projects", headers=auth)

    assert created.status_code == 200
    assert active.status_code == 200
    body = listed.json()
    assert body["active_path"] == str(workspace)
    assert body["projects"][0]["path"] == str(workspace)
    assert body["projects"][0]["name"] == "Repo"


def test_worktree_list_add_remove_and_branch_switch(client, auth, tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    worktree = tmp_path / "repo-feature"
    _init_repo(repo)
    _run_git(repo, "checkout", "-b", "feature")
    _run_git(repo, "checkout", "main")
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: _RawGitRunner())

    added = client.post(
        "/desktop/api/projects/worktrees/add",
        json={"repo_path": str(repo), "path": str(worktree), "branch": "feature"},
        headers=auth,
    )
    listed = client.get(
        "/desktop/api/projects/worktrees",
        params={"repo_path": str(repo)},
        headers=auth,
    )
    branches = client.get(
        "/desktop/api/projects/branches",
        params={"repo_path": str(repo)},
        headers=auth,
    )
    switched = client.post(
        "/desktop/api/projects/branches/switch",
        json={"path": str(repo), "branch": "feature"},
        headers=auth,
    )
    removed = client.post(
        "/desktop/api/projects/worktrees/remove",
        json={"repo_path": str(repo), "path": str(worktree)},
        headers=auth,
    )

    assert added.status_code == 200
    assert any(item["path"] == str(worktree) for item in listed.json()["worktrees"])
    assert "feature" in branches.json()["branches"]
    assert switched.status_code == 409
    assert switched.json()["detail"] == "BRANCH_ALREADY_CHECKED_OUT"
    assert removed.status_code == 200
    assert worktree.exists() is False


def test_worktree_mutation_rejects_read_only_sandbox(client, auth, tmp_path):
    repo = tmp_path / "repo"
    worktree = tmp_path / "repo-feature"
    _init_repo(repo)
    settings = client.get("/desktop/api/settings", headers=auth).json()
    settings["desktop_sandbox"] = {"mode": "read-only", "network_access": "restricted"}
    saved = client.put("/desktop/api/settings", json=settings, headers=auth)
    assert saved.status_code == 200

    response = client.post(
        "/desktop/api/projects/worktrees/add",
        json={"repo_path": str(repo), "path": str(worktree), "branch": "feature"},
        headers=auth,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "SANDBOX_READ_ONLY"

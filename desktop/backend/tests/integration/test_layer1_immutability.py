import hashlib
from pathlib import Path


def _hash_tree(root: Path) -> dict[str, str]:
    h: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            h[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return h


def test_l1_unmodified_after_full_battery(client, auth, hermes_home):
    l1 = {
        "cron": _hash_tree(hermes_home / "cron"),
        "cache": _hash_tree(hermes_home / "cache"),
    }
    for _ in range(50):
        client.get("/desktop/api/cron/jobs", headers=auth)
        client.get("/desktop/api/cron/jobs/job_test_001", headers=auth)
        client.get("/desktop/api/model/providers", headers=auth)
        client.get("/desktop/api/model/catalog", headers=auth)
        client.get("/desktop/api/settings", headers=auth)
        client.put(
            "/desktop/api/settings",
            json={"schema_version": 1, "ui": {"theme": "dark"}},
            headers=auth,
        )
        client.patch(
            "/desktop/api/overlays/cron/job_test_001",
            json={"pinned": True},
            headers=auth,
        )
    after = {
        "cron": _hash_tree(hermes_home / "cron"),
        "cache": _hash_tree(hermes_home / "cache"),
    }
    assert l1 == after

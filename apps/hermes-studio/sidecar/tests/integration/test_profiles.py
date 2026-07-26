"""Integration tests for desktop profile endpoints."""
from __future__ import annotations

import yaml


def _create_session(client, auth) -> str:
    resp = client.post("/desktop/api/sessions", json={}, headers=auth)
    assert resp.status_code == 200
    return resp.json()["session_id"]


def test_default_profile_is_seeded_and_existing_sessions_remain_visible(
    client,
    auth,
    hermes_home,
):
    sid = _create_session(client, auth)

    resp = client.get("/desktop/api/profiles", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body["activeProfileId"] == "default"
    assert body["activeProfile"]["id"] == "default"
    assert body["activeProfile"]["hermesHome"] == str(hermes_home)
    assert [p["id"] for p in body["profiles"]] == ["default"]

    sessions = client.get("/desktop/api/sessions", headers=auth)
    assert sessions.status_code == 200
    assert [row["id"] for row in sessions.json()] == [sid]


def test_active_profile_scopes_normal_session_list(client, auth):
    default_sid = _create_session(client, auth)

    created = client.post(
        "/desktop/api/profiles",
        json={"name": "research", "cloneFrom": "default"},
        headers=auth,
    )
    assert created.status_code == 200

    switch = client.put(
        "/desktop/api/profiles/active",
        json={"profileId": "research"},
        headers=auth,
    )
    assert switch.status_code == 200

    empty = client.get("/desktop/api/sessions", headers=auth)
    assert empty.status_code == 200
    assert empty.json() == []

    research_sid = _create_session(client, auth)
    current = client.get("/desktop/api/sessions", headers=auth)
    assert [row["id"] for row in current.json()] == [research_sid]

    switch_back = client.put(
        "/desktop/api/profiles/active",
        json={"profileId": "default"},
        headers=auth,
    )
    assert switch_back.status_code == 200

    default_sessions = client.get("/desktop/api/sessions", headers=auth)
    assert [row["id"] for row in default_sessions.json()] == [default_sid]


def test_profile_sessions_all_returns_tagged_cross_profile_rows(client, auth):
    default_sid = _create_session(client, auth)
    created = client.post(
        "/desktop/api/profiles",
        json={"name": "research", "cloneFrom": "default"},
        headers=auth,
    )
    assert created.status_code == 200
    assert client.put(
        "/desktop/api/profiles/active",
        json={"profileId": "research"},
        headers=auth,
    ).status_code == 200
    research_sid = _create_session(client, auth)

    resp = client.get("/desktop/api/profiles/sessions?profile=all", headers=auth)

    assert resp.status_code == 200
    rows = {row["id"]: row for row in resp.json()["sessions"]}
    assert rows[default_sid]["profileId"] == "default"
    assert rows[default_sid]["profileName"] == "default"
    assert rows[research_sid]["profileId"] == "research"
    assert rows[research_sid]["profileName"] == "research"
    assert resp.json()["profileTotals"] == {"default": 1, "research": 1}


def test_switching_active_profile_changes_config_source(client, auth, hermes_home):
    default_config = hermes_home / "config.yaml"
    created = client.post(
        "/desktop/api/profiles",
        json={"name": "research", "cloneFrom": "default"},
        headers=auth,
    )
    assert created.status_code == 200
    profile_home = hermes_home / "profiles" / "research"

    switch = client.put(
        "/desktop/api/profiles/active",
        json={"profileId": "research"},
        headers=auth,
    )
    assert switch.status_code == 200

    current = client.get("/desktop/api/config", headers=auth)
    assert current.status_code == 200
    payload = current.json()["config"]
    payload["voice"] = {**payload.get("voice", {}), "max_recording_seconds": 45}
    saved = client.put(
        "/desktop/api/config",
        json={
            "config": payload,
            "changed_paths": ["voice.max_recording_seconds"],
        },
        headers=auth,
    )
    assert saved.status_code == 200

    profile_data = yaml.safe_load((profile_home / "config.yaml").read_text(encoding="utf-8"))
    default_data = yaml.safe_load(default_config.read_text(encoding="utf-8"))
    assert profile_data["voice"]["max_recording_seconds"] == 45
    assert "voice" not in default_data

    switch_back = client.put(
        "/desktop/api/profiles/active",
        json={"profileId": "default"},
        headers=auth,
    )
    assert switch_back.status_code == 200
    reread_default = client.get("/desktop/api/config", headers=auth)
    assert (
        reread_default.json()["config"].get("voice", {}).get("max_recording_seconds")
        != 45
    )


def test_active_profile_scopes_model_assignment_config(client, auth, hermes_home):
    default_config = hermes_home / "config.yaml"
    created = client.post(
        "/desktop/api/profiles",
        json={"name": "research", "cloneFrom": "default"},
        headers=auth,
    )
    assert created.status_code == 200
    profile_home = hermes_home / "profiles" / "research"
    profile_config = profile_home / "config.yaml"

    default_config.write_text(
        "model:\n"
        "  provider: default-provider\n"
        "  default: default-model\n",
        encoding="utf-8",
    )
    profile_config.write_text(
        "model:\n"
        "  provider: profile-provider\n"
        "  default: profile-model\n",
        encoding="utf-8",
    )

    switch = client.put(
        "/desktop/api/profiles/active",
        json={"profileId": "research"},
        headers=auth,
    )
    assert switch.status_code == 200

    assigned = client.post(
        "/desktop/api/model/assignment",
        json={
            "scope": "auxiliary",
            "task": "vision",
            "provider": "aux-provider",
            "model": "aux-model",
        },
        headers=auth,
    )

    assert assigned.status_code == 200
    default_data = yaml.safe_load(default_config.read_text(encoding="utf-8"))
    profile_data = yaml.safe_load(profile_config.read_text(encoding="utf-8"))
    assert "auxiliary" not in default_data
    assert profile_data["auxiliary"]["vision"]["provider"] == "aux-provider"
    assert profile_data["auxiliary"]["vision"]["model"] == "aux-model"

    current_aux = client.get("/desktop/api/model/auxiliary", headers=auth)
    assert current_aux.status_code == 200
    vision = next(
        task for task in current_aux.json()["tasks"]
        if task["task"] == "vision"
    )
    assert vision["provider"] == "aux-provider"
    assert vision["model"] == "aux-model"

from __future__ import annotations


def test_delegation_requires_auth(client):
    r = client.get("/desktop/api/delegation/status")

    assert r.status_code == 401
    assert r.json()["code"] == "AUTH_FAILED"


def test_delegation_pause_is_process_global(client, auth):
    try:
        paused = client.post(
            "/desktop/api/delegation/pause",
            json={"paused": True},
            headers=auth,
        )
        assert paused.status_code == 200
        assert paused.json() == {"paused": True}

        status = client.get("/desktop/api/delegation/status", headers=auth)
        assert status.status_code == 200
        body = status.json()
        assert body["paused"] is True
        assert isinstance(body["active"], list)
        assert body["max_spawn_depth"] >= 1
        assert body["max_concurrent_children"] >= 1
    finally:
        client.post(
            "/desktop/api/delegation/pause",
            json={"paused": False},
            headers=auth,
        )


def test_subagent_interrupt_rejects_blank_id(client, auth):
    r = client.post("/desktop/api/subagents/%20%20/interrupt", headers=auth)

    assert r.status_code == 400
    assert r.json()["detail"] == "SUBAGENT_ID_REQUIRED"


def test_subagent_interrupt_unknown_id_returns_found_false(client, auth):
    r = client.post("/desktop/api/subagents/missing-subagent/interrupt", headers=auth)

    assert r.status_code == 200
    assert r.json() == {"found": False, "subagent_id": "missing-subagent"}

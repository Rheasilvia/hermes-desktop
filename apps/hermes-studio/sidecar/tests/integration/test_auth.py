def test_missing_token_rejected(client):
    r = client.get("/desktop/api/cron/jobs")
    assert r.status_code == 401
    assert r.json()["code"] == "AUTH_FAILED"


def test_wrong_token_rejected(client):
    r = client.get(
        "/desktop/api/cron/jobs",
        headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 401


def test_correct_token_accepted(client, auth):
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    assert r.status_code == 200


def test_session_runtime_endpoint_requires_token(client):
    r = client.patch(
        "/desktop/api/sessions/session-1/runtime",
        json={"reasoningEffort": "medium"},
    )
    assert r.status_code == 401

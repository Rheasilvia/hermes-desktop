def test_health_no_auth_required(client):
    r = client.get("/desktop/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

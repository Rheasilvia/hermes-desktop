def test_cors_allows_only_studio_and_fixed_development_origins(client):
    allowed = (
        "hermes-studio://app",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    )
    for origin in allowed:
        response = client.options(
            "/desktop/api/health",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin

    rejected = client.options(
        "/desktop/api/health",
        headers={
            "Origin": "http://localhost:9999",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers

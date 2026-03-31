def test_csp_header_is_added_to_responses(client):
    response = client.get("/login")

    csp = response.headers["content-security-policy"]

    assert response.status_code == 200
    assert "script-src" in csp
    assert "nonce-" in csp

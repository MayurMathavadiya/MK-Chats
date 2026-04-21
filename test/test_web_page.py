from test.factories import UserFactory


def test_root_redirects_to_login_when_not_authenticated(client):
    response = client.get("/", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/login"


def test_root_renders_chat_page_for_authenticated_user(client, db_session, auth_cookie):
    user = UserFactory(first_name="Alice", last_name="Stone")
    db_session.commit()

    client.cookies.set("access_token", auth_cookie(user.id))
    response = client.get("/")

    assert response.status_code == 200
    assert "Search conversations..." in response.text


def test_login_page_redirects_authenticated_user_home(client, db_session, auth_cookie):
    user = UserFactory()
    db_session.commit()

    client.cookies.set("access_token", auth_cookie(user.id))
    response = client.get("/login", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/"


def test_forgot_password_page_renders(client):
    response = client.get("/forgot-password")

    assert response.status_code == 200
    assert "Reset Password" in response.text


def test_privacy_page_renders(client):
    response = client.get("/privacy")

    assert response.status_code == 200
    assert "Privacy Policy" in response.text


def test_terms_page_renders(client):
    response = client.get("/terms")

    assert response.status_code == 200
    assert "Terms and Conditions" in response.text

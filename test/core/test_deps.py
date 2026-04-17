import pytest
from fastapi import HTTPException
from types import SimpleNamespace 

from app.core import deps, auth
from test.factories import UserFactory


def test_get_current_user_rejects_inactive_user(db_session, auth_cookie):
    user = UserFactory(is_active=False)
    db_session.commit()
    request = SimpleNamespace(headers={}, cookies={"access_token": auth_cookie(user.id)})

    with pytest.raises(HTTPException) as exc_info:
        deps.get_current_user(request, db_session)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "User not found or inactive"


def test_get_current_user_accepts_authorization_header(db_session, access_token):
    user = UserFactory()
    db_session.commit()
    request = SimpleNamespace(
        headers={"Authorization": f"Bearer {access_token(user.id)}"},
        cookies={},
    )

    current_user = deps.get_current_user(request, db_session)

    assert current_user.id == user.id


@pytest.mark.asyncio
async def test_get_user_id_from_environ_reads_cookie(auth_cookie):
    token = auth_cookie(9)
    environ = {"HTTP_COOKIE": f'access_token="{token}"'}

    assert await auth.get_user_from_environ(environ) == 9



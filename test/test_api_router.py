from datetime import datetime, timedelta, timezone

from app.core import auth
from app import models, routers
from test.factories import BlockedUserFactory, CallLogFactory, ChatClearFactory, MessageFactory, UserFactory


def register_payload(**overrides):
    payload = {
        "mobile_number": "+911111111111",
        "email": "new-user@example.com",
        "first_name": "New",
        "last_name": "User",
        "password": "secret123",
        "public_key": "public",
        "encrypted_private_key": "private",
        "encrypted_dek": "dek",
        "keys_salt": "salt",
        "dek_iv": "dek-iv",
        "priv_key_iv": "priv-iv",
    }
    payload.update(overrides)
    return payload


def authenticate_client(client, user_id, auth_cookie):
    client.cookies.set("access_token", auth_cookie(user_id))


def authenticate_client_with_bearer(client, user_id, access_token):
    client.headers["Authorization"] = f"Bearer {access_token(user_id)}"


def test_register_creates_user_and_sets_cookie(client):
    response = client.post("/api/register", json=register_payload())

    assert response.status_code == 200
    assert response.json()["email"] == "new-user@example.com"
    assert "access_token" in response.cookies


def test_register_rejects_duplicate_email(client, db_session):
    UserFactory(email="existing@example.com", mobile_number="+912222222222")
    db_session.commit()

    response = client.post(
        "/api/register",
        json=register_payload(email="existing@example.com"),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Mobile number or Email already registered"


def test_login_returns_user_crypto_data(client, db_session):
    user = UserFactory(mobile_number="+913333333333")
    db_session.commit()

    response = client.post(
        "/api/login",
        json={"mobile_number": user.mobile_number, "password": "secret123"},
    )

    payload = response.json()

    assert response.status_code == 200
    assert payload["user_id"] == user.id
    assert payload["encrypted_private_key"] == user.encrypted_private_key


def test_logout_clears_cookie_and_marks_user_offline(client, db_session, auth_cookie):
    user = UserFactory(last_seen=datetime.now(timezone.utc))
    db_session.commit()
    authenticate_client(client, user.id, auth_cookie)

    response = client.post("/api/logout")
    db_session.refresh(user)

    assert response.status_code == 200
    assert response.json()["msg"] == "Successfully logged out"
    assert user.last_seen is None


def test_get_and_update_profile(client, db_session, auth_cookie):
    user = UserFactory(first_name="Before", last_name="User")
    db_session.commit()
    authenticate_client(client, user.id, auth_cookie)

    get_response = client.get("/api/profile")
    patch_response = client.patch(
        "/api/profile",
        json={"first_name": "After", "profile_pic": "avatar-data"},
    )

    assert get_response.status_code == 200
    assert get_response.json()["first_name"] == "Before"
    assert patch_response.status_code == 200
    assert patch_response.json()["first_name"] == "After"
    assert patch_response.json()["profile_pic"] == "avatar-data"


def test_profile_endpoints_accept_bearer_token(client, db_session, access_token):
    user = UserFactory(first_name="Bearer", last_name="User")
    db_session.commit()
    authenticate_client_with_bearer(client, user.id, access_token)

    response = client.get("/api/profile")

    assert response.status_code == 200
    assert response.json()["id"] == user.id


def test_update_password_requires_correct_old_password(client, db_session, auth_cookie):
    user = UserFactory()
    db_session.commit()
    authenticate_client(client, user.id, auth_cookie)

    bad_response = client.post(
        "/api/profile/password",
        json={
            "old_password": "wrong-password",
            "new_password": "new-secret123",
            "encrypted_dek": "new-dek",
            "dek_iv": "new-iv",
            "keys_salt": "new-salt",
        },
    )

    ok_response = client.post(
        "/api/profile/password",
        json={
            "old_password": "secret123",
            "new_password": "new-secret123",
            "encrypted_dek": "new-dek",
            "dek_iv": "new-iv",
            "keys_salt": "new-salt",
        },
    )

    db_session.refresh(user)

    assert bad_response.status_code == 400
    assert ok_response.status_code == 200
    assert auth.verify_password("new-secret123", user.password_hash) is True


def test_forgot_password_registered_and_unknown_email(client, db_session, monkeypatch):
    user = UserFactory(email="known@example.com")
    db_session.commit()
    sent_calls = []

    async def fake_send_password_reset_email(to_email, token, host):
        sent_calls.append((to_email, token, host))

    monkeypatch.setattr(
        "app.api_user.send_password_reset_email", 
        fake_send_password_reset_email
    )

    known_response = client.post(
        "/api/forgot-password",
        json={"email": user.email},
    )
    unknown_response = client.post(
        "/api/forgot-password",
        json={"email": "unknown@example.com"},
    )

    assert known_response.status_code == 200
    assert known_response.json()["msg"] == "Password reset link sent."
    assert unknown_response.json()["msg"] == "Your email is not registered."
    assert len(sent_calls) == 1
    assert sent_calls[0][0] == user.email


def test_reset_password_updates_credentials_and_deletes_messages(client, db_session):
    user = UserFactory()
    contact = UserFactory()
    MessageFactory(sender=user, receiver=contact)
    MessageFactory(sender=contact, receiver=user)
    db_session.commit()
    token = auth.create_access_token({"sub": str(user.id), "scope": "reset_password"})

    response = client.post(
        "/api/reset-password",
        json={
            "token": token,
            "new_password": "fresh-secret123",
            "public_key": "new-public",
            "encrypted_private_key": "new-private",
            "encrypted_dek": "new-dek",
            "keys_salt": "new-salt",
            "dek_iv": "new-iv",
            "priv_key_iv": "new-priv-iv",
        },
    )

    db_session.refresh(user)

    assert response.status_code == 200
    assert auth.verify_password("fresh-secret123", user.password_hash) is True


def test_contacts_endpoint_returns_contact_data(client, db_session, auth_cookie):
    current_user = UserFactory()
    contact = UserFactory(first_name="Contact")
    MessageFactory(sender=contact, receiver=current_user, content="latest", is_read=False)
    BlockedUserFactory(user_id=current_user.id, blocked_contact_id=contact.id)
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    contacts_response = client.get("/api/contacts")
    contacts = contacts_response.json()

    assert contacts_response.status_code == 200
    assert contacts[0]["id"] == contact.id
    assert contacts[0]["blocked_by_me"] is True
    assert contacts[0]["unread_count"] == 1


def test_contacts_search_returns_matching_users_without_history(client, db_session, auth_cookie):
    current_user = UserFactory()
    searchable_only_user = UserFactory(first_name="Contactless", last_name="User")
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    # Search by mobile number for a user with NO history (proving they are still discoverable)
    search_response = client.get("/api/contacts", params={"query": searchable_only_user.mobile_number})
    
    assert search_response.status_code == 200
    
    search_result_ids = [item["id"] for item in search_response.json()]
    assert searchable_only_user.id in search_result_ids


def test_block_and_unblock_contact(client, db_session, auth_cookie):
    current_user = UserFactory()
    contact = UserFactory()
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    block_response = client.post(
        "/api/contacts/block",
        json={"blocked_contact_id": contact.id},
    )
    
    duplicate_response = client.post(
        "/api/contacts/block",
        json={"blocked_contact_id": contact.id},
    )
    
    unblock_response = client.post(
        "/api/contacts/unblock",
        json={"blocked_contact_id": contact.id},
    )

    assert block_response.json()["msg"] == "User blocked"
    assert duplicate_response.json()["msg"] == "User already blocked"
    assert unblock_response.json()["msg"] == "User unblocked"


def test_create_update_and_list_call_logs(client, db_session, auth_cookie):
    current_user = UserFactory()
    contact = UserFactory()
    older_contact = UserFactory()
    CallLogFactory(
        initiator_id=older_contact.id,
        receiver_id=current_user.id,
        started_by_id=older_contact.id,
        status="missed",
        call_type="audio",
        final_call_type="audio",
    )
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    create_response = client.post(
        "/api/calls",
        json={"receiver_id": contact.id, "call_type": "video"},
    )

    assert create_response.status_code == 200
    call_id = create_response.json()["id"]
    assert create_response.json()["call_type"] == "video"
    assert create_response.json()["status"] == "initiated"

    update_response = client.patch(
        f"/api/calls/{call_id}",
        json={"status": "accepted", "final_call_type": "video"},
    )

    assert update_response.status_code == 200
    assert update_response.json()["status"] == "accepted"
    assert update_response.json()["accepted_by_id"] == current_user.id

    end_response = client.patch(
        f"/api/calls/{call_id}",
        json={"status": "ended", "final_call_type": "video"},
    )

    assert end_response.status_code == 200
    assert end_response.json()["status"] == "ended"
    assert end_response.json()["duration_seconds"] >= 0

    history_response = client.get("/api/calls/history", params={"contact_id": contact.id})

    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 1
    assert history[0]["id"] == call_id


def test_get_messages_respects_chat_clear(client, db_session, auth_cookie):
    current_user = UserFactory()
    contact = UserFactory()
    
    old_message = MessageFactory(
        sender=current_user,
        receiver=contact,
        content="old",
        created_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    
    new_message = MessageFactory(
        sender=contact,
        receiver=current_user,
        content="new",
        created_at=datetime.now(timezone.utc),
    )
    
    ChatClearFactory(
        user_id=current_user.id,
        contact_id=contact.id,
        cleared_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )

    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    response = client.get(f"/api/messages/{contact.id}")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [new_message.id]
    assert response.json()[0]["id"] != old_message.id


def test_update_call_log_statuses(client, db_session, auth_cookie):
    current_user = UserFactory()
    contact = UserFactory()
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    # Test ringing
    call = CallLogFactory(initiator_id=contact.id, receiver_id=current_user.id)
    db_session.commit()
    
    ringing_response = client.patch(
        f"/api/calls/{call.id}",
        json={"status": "ringing"}
    )
    assert ringing_response.status_code == 200
    assert ringing_response.json()["status"] == "ringing"

    # Test rejected
    rejected_response = client.patch(
        f"/api/calls/{call.id}",
        json={"status": "rejected"}
    )
    assert rejected_response.status_code == 200
    assert rejected_response.json()["status"] == "rejected"
    assert rejected_response.json()["ended_at"] is not None

    # Test missed
    call_missed = CallLogFactory(initiator_id=contact.id, receiver_id=current_user.id)
    db_session.commit()
    
    missed_response = client.patch(
        f"/api/calls/{call_missed.id}",
        json={"status": "missed"}
    )
    assert missed_response.status_code == 200
    assert missed_response.json()["status"] == "missed"


def test_message_replies_and_files(client, db_session, auth_cookie):
    current_user = UserFactory()
    contact = UserFactory()
    original_msg = MessageFactory(sender=contact, receiver=current_user)
    db_session.commit()
    
    reply_msg = MessageFactory(
        sender=current_user,
        receiver=contact,
        reply_to_id=original_msg.id,
        file_data="base64-data",
        file_type="image/png"
    )
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    response = client.get(f"/api/messages/{contact.id}")
    messages = response.json()
    
    # Find the reply message
    reply = next(m for m in messages if m["id"] == reply_msg.id)
    
    assert reply["reply_to_id"] == original_msg.id
    assert reply["file_data"] == "base64-data"
    assert reply["file_type"] == "image/png"


def test_clear_chat_creates_clear_record_and_schedules_cleanup(
    client,
    db_session,
    auth_cookie,
    monkeypatch,
):
    current_user = UserFactory()
    contact = UserFactory()
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)
    cleanup_calls = []

    def fake_delete_cleared_messages(contact_id, user_id, now_utc):
        cleanup_calls.append((contact_id, user_id, now_utc))

    monkeypatch.setattr(
        "app.api_message.background_jobs.delete_cleared_messages", 
        fake_delete_cleared_messages
    )

    response = client.post(f"/api/messages/clear/{contact.id}")

    clear_record = db_session.query(models.ChatClear).filter_by(
        user_id=current_user.id,
        contact_id=contact.id,
    ).first()

    assert response.status_code == 200
    assert response.json()["msg"] == "Chat cleared"
    assert clear_record is not None
    assert len(cleanup_calls) == 1


def test_contacts_pagination(client, db_session, auth_cookie):
    current_user = UserFactory()
    # Create 5 contacts with messages
    for i in range(5):
        contact = UserFactory(first_name=f"Contact{i}")
        MessageFactory(sender=current_user, receiver=contact, created_at=datetime.now(timezone.utc) - timedelta(hours=i))
    
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    # Test limit=2
    response_l2 = client.get("/api/contacts", params={"limit": 2})
    assert len(response_l2.json()) == 2

    # Test offset=2, limit=2
    response_o2 = client.get("/api/contacts", params={"limit": 2, "offset": 2})
    assert len(response_o2.json()) == 2
    # The first contact in this page should be Contact2 (since we ordered by created_at desc)
    assert response_o2.json()[0]["first_name"] == "Contact2"


def test_messages_pagination(client, db_session, auth_cookie):
    current_user = UserFactory()
    contact = UserFactory()
    # Create 10 messages
    for i in range(10):
        MessageFactory(sender=current_user, receiver=contact, content=f"Msg{i}", created_at=datetime.now(timezone.utc) - timedelta(minutes=i))
    
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    # Get first page (limit 5)
    response_p1 = client.get(f"/api/messages/{contact.id}", params={"limit": 5})
    assert len(response_p1.json()) == 5
    # Since we use subquery ordering, the latest messages are fetched and then sorted ASC for the user.
    # The first message in the last 5 messages (Msg4 to Msg0 in terms of creation) should be Msg4.
    assert response_p1.json()[0]["content"] == "Msg4"


def test_register_rejects_duplicate_email_specifically(client, db_session):
    UserFactory(email="dup@example.com", mobile_number="+910000000000")
    db_session.commit()

    # Try duplicate email with NEW mobile
    response = client.post(
        "/api/register",
        json=register_payload(email="dup@example.com", mobile_number="+919999999999"),
    )
    assert response.status_code == 400


def test_update_call_log_invalid_data(client, db_session, auth_cookie):
    current_user = UserFactory()
    contact = UserFactory()
    call = CallLogFactory(initiator_id=current_user.id, receiver_id=contact.id)
    db_session.commit()
    authenticate_client(client, current_user.id, auth_cookie)

    # Invalid status
    response_status = client.patch(f"/api/calls/{call.id}", json={"status": "invalid"})
    assert response_status.status_code == 400

    # Invalid call type
    response_type = client.patch(f"/api/calls/{call.id}", json={"final_call_type": "invalid"})
    assert response_type.status_code == 400

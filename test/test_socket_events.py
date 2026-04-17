import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from app import socket_events, models
from test.factories import UserFactory, MessageFactory, BlockedUserFactory


@pytest.mark.asyncio
async def test_socket_connect_success(mock_sio, mock_redis, auth_cookie):
    user = UserFactory()
    # Mocking environ to simulate valid auth cookie
    environ = {
        'HTTP_COOKIE': f'access_token={auth_cookie(user.id)}'
    }
    
    sid = "test-sid"
    result = await socket_events.connect(sid, environ)
    
    assert result is not False
    assert mock_sio.session_data['user_id'] == user.id
    mock_sio.enter_room.assert_called_with(sid, str(user.id))
    
    # Check redis presence
    assert await mock_redis.get(f"user:{user.id}:connections") == "1"
    assert await mock_redis.sismember("online_users", str(user.id))


@pytest.mark.asyncio
async def test_socket_connect_failure(mock_sio, mock_redis):
    environ = {} # No auth
    sid = "test-sid"
    result = await socket_events.connect(sid, environ)
    
    assert result is False
    assert 'user_id' not in mock_sio.session_data


@pytest.mark.asyncio
async def test_socket_disconnect(mock_sio, mock_redis):
    user_id = 123
    mock_sio.session_data['user_id'] = user_id
    await mock_redis.set(f"user:{user_id}:connections", "1")
    await mock_redis.sadd("online_users", user_id)
    
    sid = "test-sid"
    await socket_events.disconnect(sid)
    
    assert await mock_redis.get(f"user:{user_id}:connections") is None
    assert not await mock_redis.sismember("online_users", str(user_id))
    mock_sio.emit.assert_called_with('presence', {'user_id': user_id, 'status': 'offline'})


@pytest.mark.asyncio
async def test_socket_send_message(mock_sio, mock_redis, db_session):
    sender = UserFactory()
    receiver = UserFactory()
    db_session.commit()
    
    mock_sio.session_data['user_id'] = sender.id
    sid = "test-sid"
    data = {
        'receiver_id': receiver.id,
        'content': 'Hello, Socket!'
    }
    
    await socket_events.send(sid, data)
    
    # Check DB
    msg = db_session.query(models.Message).filter_by(sender_id=sender.id, receiver_id=receiver.id).first()
    assert msg is not None
    assert msg.content == 'Hello, Socket!'
    
    # Check broadcast
    assert mock_sio.emit.call_count == 2
    # Verify it was emitted to both rooms
    emitted_rooms = [call.kwargs.get('room') for call in mock_sio.emit.call_args_list]
    assert str(receiver.id) in emitted_rooms
    assert str(sender.id) in emitted_rooms


@pytest.mark.asyncio
async def test_socket_send_message_blocked(mock_sio, mock_redis, db_session):
    sender = UserFactory()
    receiver = UserFactory()
    BlockedUserFactory(user_id=receiver.id, blocked_contact_id=sender.id)
    db_session.commit()
    
    mock_sio.session_data['user_id'] = sender.id
    sid = "test-sid"
    data = {
        'receiver_id': receiver.id,
        'content': 'Blocked message'
    }
    
    await socket_events.send(sid, data)
    
    # Check DB - should be empty
    msg = db_session.query(models.Message).filter_by(content='Blocked message').first()
    assert msg is None
    assert mock_sio.emit.call_count == 0


@pytest.mark.asyncio
async def test_socket_typing(mock_sio, mock_redis):
    user_id = 456
    mock_sio.session_data['user_id'] = user_id
    sid = "test-sid"
    data = {'receiver_id': 789, 'typing': True}
    
    await socket_events.typing(sid, data)
    
    mock_sio.emit.assert_called_with('typing', {
        'receiver_id': 789, 
        'typing': True, 
        'sender_id': user_id
    }, room='789')


@pytest.mark.asyncio
async def test_socket_mark_read(mock_sio, mock_redis, db_session):
    reader = UserFactory()
    sender = UserFactory()
    msg = MessageFactory(sender=sender, receiver=reader, is_read=False)
    db_session.commit()
    
    mock_sio.session_data['user_id'] = reader.id
    sid = "test-sid"
    data = {'contact_id': sender.id}
    
    await socket_events.mark_read(sid, data)
    
    db_session.refresh(msg)
    assert msg.is_read is True
    
    # Verify read receipt signals
    # One to sender, one to self (sync)
    assert mock_sio.emit.call_count == 2


@pytest.mark.asyncio
async def test_socket_webrtc_signaling(mock_sio, mock_redis):
    user_id = 1
    mock_sio.session_data['user_id'] = user_id
    sid = "test-sid"
    data = {'receiver_id': 2, 'offer': 'sdp-data'}
    
    await socket_events.webrtc_offer(sid, data)
    
    mock_sio.emit.assert_called_with('webrtc_offer', {
        'receiver_id': 2, 
        'offer': 'sdp-data', 
        'sender_id': user_id
    }, room='2')


@pytest.mark.asyncio
async def test_socket_edit_message(mock_sio, db_session):
    user = UserFactory()
    msg = MessageFactory(sender=user, content="Original")
    db_session.commit()
    
    mock_sio.session_data['user_id'] = user.id
    sid = "test-sid"
    data = {'id': msg.id, 'content': 'Edited'}
    
    await socket_events.edit(sid, data)
    
    db_session.refresh(msg)
    assert msg.content == 'Edited'
    assert msg.is_edited is True
    assert mock_sio.emit.call_count == 2 # receiver and sender


@pytest.mark.asyncio
async def test_socket_delete_message(mock_sio, db_session):
    user = UserFactory()
    msg = MessageFactory(sender=user)
    db_session.commit()
    
    mock_sio.session_data['user_id'] = user.id
    sid = "test-sid"
    data = {'id': msg.id}
    
    await socket_events.delete(sid, data)
    
    db_session.refresh(msg)
    assert msg.is_deleted is True
    assert mock_sio.emit.call_count == 2


@pytest.mark.asyncio
async def test_socket_request_presence(mock_sio, mock_redis):
    sid = "test-sid"
    await mock_redis.sadd("online_users", "10", "11")
    
    await socket_events.request_presence(sid)
    
    # Check that presence_sync was emitted with the list of online users
    # We call list() on smembers result so emitted data should be a list
    emitted_call = next(c for c in mock_sio.emit.call_args_list if c.args[0] == 'presence_sync')
    online_list = emitted_call.args[1]
    assert "10" in online_list
    assert "11" in online_list


@pytest.mark.asyncio
async def test_socket_webrtc_signaling_full(mock_sio):
    user_id = 100
    mock_sio.session_data['user_id'] = user_id
    sid = "test-sid"
    
    # Test Answer
    await socket_events.webrtc_answer(sid, {'receiver_id': 200, 'answer': 'sdp'})
    mock_sio.emit.assert_any_call('webrtc_answer', {'receiver_id': 200, 'answer': 'sdp', 'sender_id': user_id}, room='200')
    
    # Test ICE Candidate
    await socket_events.webrtc_ice_candidate(sid, {'receiver_id': 200, 'candidate': 'ice'})
    mock_sio.emit.assert_any_call('webrtc_ice_candidate', {'receiver_id': 200, 'candidate': 'ice', 'sender_id': user_id}, room='200')
    
    # Test End
    await socket_events.webrtc_end(sid, {'receiver_id': 200})
    mock_sio.emit.assert_any_call('webrtc_end', {'receiver_id': 200, 'sender_id': user_id}, room='200')

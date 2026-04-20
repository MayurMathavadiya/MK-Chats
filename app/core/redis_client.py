import redis
import json
from app.core.config import settings

# Initialize Redis client
redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

def store_webauthn_challenge(user_id: str, challenge: str, state: str = "register"):
    key = f"webauthn:{state}:{user_id}"
    redis_client.setex(key, 300, challenge) # 5 minutes TTL

def get_webauthn_challenge(user_id: str, state: str = "register"):
    key = f"webauthn:{state}:{user_id}"
    return redis_client.get(key)

def delete_webauthn_challenge(user_id: str, state: str = "register"):
    key = f"webauthn:{state}:{user_id}"
    redis_client.delete(key)

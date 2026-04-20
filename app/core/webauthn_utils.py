import os
import json
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
)
from webauthn.helpers import options_to_json
from webauthn.helpers.structs import (
    RegistrationCredential,
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement,
    AuthenticatorAttachment,
)

from app.core.config import settings

RP_ID = settings.WEBAUTHN_RP_ID
RP_NAME = settings.WEBAUTHN_RP_NAME

def get_registration_options(user_id: int, user_email: str):
    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=str(user_id).encode(),
        user_name=user_email,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    
    # Manually inject extensions since py-webauthn 2.x doesn't support them in generate_*
    options_dict = json.loads(options_to_json(options))
    options_dict["extensions"] = {"prf": {"enabled": True}}
    return options_dict

def verify_registration(options, credential, public_key=None):
    return verify_registration_response(
        credential=credential,
        expected_challenge=options["challenge"],
        expected_origin=f"http://{RP_ID}:8000" if RP_ID == "localhost" else f"https://{RP_ID}",
        expected_rp_id=RP_ID,
        require_user_verification=True,
    )

def get_authentication_options(existing_credentials=None):
    # We use PRF with a fixed salt to derive the key
    # Salt must be 32 bytes
    salt_b64 = "bWstY2hhdHMtcHJmLXNhbHQtdjEtMzJieXRlcy1sZW4=" # Base64 of 'mk-chats-prf-salt-v1-32bytes-len'
    
    options = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=existing_credentials,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    
    # Manually inject extensions
    options_dict = json.loads(options_to_json(options))
    options_dict["extensions"] = {
        "prf": {
            "eval": {
                "first": salt_b64
            }
        }
    }
    return options_dict

def verify_authentication(options, credential, public_key, sign_count):
    return verify_authentication_response(
        credential=credential,
        expected_challenge=options["challenge"],
        expected_origin=f"http://{RP_ID}:8000" if RP_ID == "localhost" else f"https://{RP_ID}",
        expected_rp_id=RP_ID,
        credential_public_key=public_key,
        credential_current_sign_count=sign_count,
        require_user_verification=True,
    )

import base64
import hashlib
import hmac
import json

from voice_service.auth import (
    bearer,
    callback_token,
    check_callback_token,
    outbound_token,
    sign_service_token,
    verify_service_token,
)

S = "secret"


def test_token_matches_the_service_auth_package_format() -> None:
    # packages/service-auth: base64url(payload) '.' base64url(hmac_sha256(secret, payload)), no padding.
    tok = sign_service_token({"service": "voice", "tenantId": "t"}, S, ttl_s=60, now=1000)
    p, s = tok.split(".")
    payload = base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))
    assert json.loads(payload) == {"service": "voice", "tenantId": "t", "exp": 1060}
    expected = base64.urlsafe_b64encode(hmac.new(S.encode(), payload, hashlib.sha256).digest()).rstrip(b"=").decode()
    assert s == expected and "=" not in tok


def test_verify_round_trip_tamper_and_expiry() -> None:
    tok = sign_service_token({"service": "controller", "tenantId": "t"}, S, now=1000)
    assert verify_service_token(tok, S, now=1030)["service"] == "controller"
    assert verify_service_token(tok, S, now=1061) is None
    assert verify_service_token(tok, "other", now=1030) is None
    p, s = tok.split(".")
    forged = base64.urlsafe_b64encode(b'{"service":"x","exp":99999}').rstrip(b"=").decode()
    assert verify_service_token(f"{forged}.{s}", S, now=1030) is None
    assert verify_service_token("garbage", S) is None
    assert verify_service_token(None, S) is None


def test_outbound_token_claims_the_platform_tenant() -> None:
    claims = verify_service_token(outbound_token(S, "call-1"), S)
    assert claims and claims["service"] == "voice" and claims["internal"] is True
    assert claims["tenantId"] == "00000000-0000-0000-0000-000000000000" and claims["callId"] == "call-1"


def test_bearer_and_callback_tokens() -> None:
    assert bearer("Bearer abc ") == "abc" and bearer("bearer x") == "x" and bearer("Basic x") is None
    t = callback_token(S, "call-1")
    assert check_callback_token(S, "call-1", t)
    assert not check_callback_token(S, "call-2", t)
    assert not check_callback_token(S, "call-1", None)

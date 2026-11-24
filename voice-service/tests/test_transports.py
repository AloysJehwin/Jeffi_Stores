import base64
import xml.etree.ElementTree as ET
from urllib.parse import parse_qsl

import httpx
import pytest

from voice_service.calls import CallStatus
from voice_service.transports.base import PlaceRequest, TransportError
from voice_service.transports.exotel import ExotelTransport
from voice_service.transports.exotel import map_status as exo_status
from voice_service.transports.twilio import (
    TwilioTransport,
    allowed_test_number,
    signature,
    twiml,
    valid_signature,
)
from voice_service.transports.twilio import map_status as tw_status

REQ = PlaceRequest(
    call_id="call-1",
    to="+919876543210",
    from_="+911400000000",
    ring_timeout_s=35,
    time_limit_s=900,
    status_url="https://voice.test/telephony/x/status/call-1?t=tok",
    stream_url="wss://voice.test/ws/twilio/call-1/tok",
)


def mock(handler):  # type: ignore[no-untyped-def]
    seen: list[httpx.Request] = []

    def wrap(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return handler(req)

    return httpx.AsyncClient(transport=httpx.MockTransport(wrap)), seen


# ── Exotel (production) ──


async def test_exotel_places_into_the_voicebot_flow() -> None:
    http, seen = mock(lambda r: httpx.Response(200, json={"Call": {"Sid": "exo-call-1", "Status": "in-progress"}}))
    t = ExotelTransport(
        sid="jeffi1", api_key="KEY", api_token="TOKEN", subdomain="api.in.exotel.com", app_id="777",
        caller_id="+911400000000", http=http,
    )
    assert await t.place_call(REQ) == "exo-call-1"
    req = seen[0]
    assert req.url == "https://api.in.exotel.com/v1/Accounts/jeffi1/Calls/connect.json"
    assert req.headers["authorization"] == "Basic " + base64.b64encode(b"KEY:TOKEN").decode()
    form = dict(parse_qsl(req.content.decode()))
    assert form["From"] == "+919876543210"
    assert form["CallerId"] == "+911400000000"
    assert form["Url"] == "http://my.exotel.com/jeffi1/exoml/start_voice/777"
    assert form["TimeOut"] == "35" and form["TimeLimit"] == "900"
    assert form["StatusCallback"] == REQ.status_url
    assert {form["StatusCallbackEvents[0]"], form["StatusCallbackEvents[1]"]} == {"answered", "terminal"}
    assert form["StatusCallbackContentType"] == "application/json"
    assert form["CustomField"] == "call-1"


async def test_exotel_errors_raise() -> None:
    http, _ = mock(lambda r: httpx.Response(403, json={"RestException": {}}))
    t = ExotelTransport(sid="s", api_key="k", api_token="t", subdomain="h", app_id="1", caller_id="+91", http=http)
    with pytest.raises(TransportError) as e:
        await t.place_call(REQ)
    assert e.value.status == 403
    http2, _ = mock(lambda r: httpx.Response(200, json={"Call": {}}))
    t2 = ExotelTransport(sid="s", api_key="k", api_token="t", subdomain="h", app_id="1", caller_id="+91", http=http2)
    with pytest.raises(TransportError):
        await t2.place_call(REQ)


@pytest.mark.parametrize(
    "raw,status",
    [
        ("ringing", CallStatus.RINGING),
        ("in-progress", CallStatus.ANSWERED),
        ("completed", CallStatus.COMPLETED),
        ("busy", CallStatus.BUSY),
        ("no-answer", CallStatus.NO_ANSWER),
        ("failed", CallStatus.FAILED),
        ("canceled", CallStatus.NO_ANSWER),
        ("queued", None),
        ("weird", None),
    ],
)
def test_exotel_status_mapping(raw: str, status: CallStatus | None) -> None:
    assert exo_status(raw) == status


def test_exotel_status_callback_payloads() -> None:
    t = ExotelTransport(sid="s", api_key="k", api_token="t", subdomain="h", app_id="1", caller_id="+91", http=None)  # type: ignore[arg-type]
    answered = t.parse_status({"CallSid": "c1", "EventType": "answered", "Status": "in-progress"})
    assert answered and answered.status == CallStatus.ANSWERED
    done = t.parse_status({"CallSid": "c1", "EventType": "terminal", "Status": "completed", "ConversationDuration": "73"})
    assert done and done.status == CallStatus.COMPLETED and done.duration_s == 73
    legs = t.parse_status({"CallSid": "c1", "Status": "completed", "Legs": [{"OnCallDuration": 40}]})
    assert legs and legs.duration_s == 40
    busy = t.parse_status({"CallSid": "c1", "EventType": "terminal", "Status": "busy"})
    assert busy and busy.status == CallStatus.BUSY and busy.duration_s is None
    assert t.parse_status({"Status": "completed"}) is None


# ── Twilio (test calls only) ──


def test_twiml_connects_a_bidirectional_stream() -> None:
    xml = twiml('wss://voice.test/ws/twilio/c&1/tok"', "c&1")
    root = ET.fromstring(xml)
    assert root.tag == "Response"
    connect = root.find("Connect")
    assert connect is not None
    stream = connect.find("Stream")
    assert stream is not None and stream.get("url") == 'wss://voice.test/ws/twilio/c&1/tok"'
    param = stream.find("Parameter")
    assert param is not None and param.get("name") == "callId" and param.get("value") == "c&1"


@pytest.mark.parametrize(
    "raw,status",
    [
        ("queued", None),
        ("initiated", None),
        ("ringing", CallStatus.RINGING),
        ("in-progress", CallStatus.ANSWERED),
        ("completed", CallStatus.COMPLETED),
        ("busy", CallStatus.BUSY),
        ("no-answer", CallStatus.NO_ANSWER),
        ("failed", CallStatus.FAILED),
        ("canceled", CallStatus.NO_ANSWER),
    ],
)
def test_twilio_status_mapping(raw: str, status: CallStatus | None) -> None:
    assert tw_status(raw) == status


def test_test_number_allowlist_fails_closed() -> None:
    allow = frozenset({"+919999900000"})
    assert allowed_test_number("+91 99999-00000", allow)
    assert not allowed_test_number("+919876543210", allow)
    assert not allowed_test_number("+919999900000", frozenset())
    assert not allowed_test_number("", allow)


async def test_twilio_places_with_inline_twiml() -> None:
    http, seen = mock(lambda r: httpx.Response(201, json={"sid": "CA123"}))
    t = TwilioTransport(account_sid="AC1", auth_token="tok", from_="+15550001111", http=http)
    assert await t.place_call(REQ) == "CA123"
    req = seen[0]
    assert req.url == "https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json"
    pairs = parse_qsl(req.content.decode())
    form = dict(pairs)
    assert form["To"] == REQ.to and form["From"] == "+15550001111" and form["Timeout"] == "35"
    assert "<Connect><Stream" in form["Twiml"] and REQ.stream_url in form["Twiml"]
    assert [v for k, v in pairs if k == "StatusCallbackEvent"] == ["initiated", "ringing", "answered", "completed"]


def test_twilio_signature() -> None:
    params = {"CallSid": "CA1", "CallStatus": "completed"}
    sig = signature("tok", "https://voice.test/x?t=1", params)
    assert valid_signature("tok", "https://voice.test/x?t=1", params, sig)
    assert not valid_signature("tok", "https://voice.test/x?t=2", params, sig)
    assert not valid_signature("tok", "https://voice.test/x?t=1", params, None)

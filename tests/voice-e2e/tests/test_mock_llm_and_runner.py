from __future__ import annotations

import json

import pytest

from e2e.mock_llm import call_ref, mock_lines, mock_reply, mock_stream
from e2e.runner import budget_minutes, select
from e2e.scenarios import all_scenarios
from e2e.voice_patches import classify_claude_error


def _user(text: str) -> dict:
    return {"role": "user", "content": [{"type": "text", "text": text}]}


def test_rules() -> None:
    assert mock_reply({"messages": [_user("[connected] Yes, this is Ramesh. I own Sri Lakshmi Sweets.")]})["text"].startswith("Nice")
    assert mock_reply({"messages": [_user("Sure, you can send it on WhatsApp.")]})["tool"] == "recordConsent"
    assert mock_reply({"messages": [_user("Please stop calling me.")]})["tool"] == "optOut"
    assert "AI assistant" in mock_reply({"messages": [_user("Am I talking to a robot?")]})["text"]
    assert mock_reply({"messages": [_user("Can we talk in Tamil please?")]}) == {"tool": "switchLanguage", "input": {"language": "ta"}}
    assert mock_reply({"messages": [_user("Okay, not interested. Bye.")]})["input"]["outcome"] == "not_interested"
    assert "still there" in mock_reply({"messages": [_user("[The person has been silent for a while.]")]})["text"]


def test_after_consent_it_starts_the_preview_with_the_business_name() -> None:
    msgs = [_user("I own Sri Lakshmi Sweets."), _user("Send it on WhatsApp."),
            {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "recordConsent", "input": {}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": '{"ok": true}'}]}]
    assert mock_reply({"messages": msgs}) == {"tool": "startPreview", "input": {"business_name": "Sri Lakshmi Sweets"}}


def test_a_failed_tool_never_reads_as_success() -> None:
    msgs = [{"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "startPreview", "input": {}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": '{"ok": false, "error": "x"}'}]}]
    assert "didn't go through" in mock_reply({"messages": msgs})["text"]


def test_stream_is_messages_api_shaped() -> None:
    events = []
    for chunk in mock_stream({"tool": "optOut", "input": {}}, "m", 10):
        lines = chunk.decode().strip().split("\n")
        assert lines[0].startswith("event: ")
        events.append(json.loads(lines[1][6:]))
    types = [e["type"] for e in events]
    assert types == ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]
    assert events[1]["content_block"]["type"] == "tool_use" and events[4]["delta"]["stop_reason"] == "tool_use"
    assert events[2]["delta"]["type"] == "input_json_delta"


def test_call_ref_and_lines() -> None:
    assert call_ref({"system": [{"type": "text", "text": "... ref:e2e-x-0-abc"}]}) == "e2e-x-0-abc"
    assert call_ref({}) == "unknown"
    assert len(mock_lines()) >= 10


def test_claude_error_classification() -> None:
    assert classify_claude_error(400, "Error: workspace API usage limits reached") == "workspace_spend_limit"
    assert classify_claude_error(401, "x") == "auth_401"
    assert classify_claude_error(500, "x") is None


def test_scenarios_are_unique_and_selectable() -> None:
    names = [s.name for s in all_scenarios()]
    assert len(names) == len(set(names))
    assert {s.name for s in select(["barge_in"], ["load"])} == {"barge_in", "concurrent_2", "concurrent_5"}
    with pytest.raises(SystemExit):
        select(["nope"], [])
    assert budget_minutes(select([], [])) <= 60


def test_every_scenario_has_a_check() -> None:
    for s in all_scenarios():
        assert s.check or s.custom, s.name
        assert s.needs <= {"sarvam", "claude"}

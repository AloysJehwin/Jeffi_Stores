"""A scripted stand-in for the Claude Messages API (no-key mode).

voice-service's Anthropic client is pointed here explicitly by the harness launcher (never through env). It answers
in the Messages API's streaming format with deterministic replies and tool calls from simple keyword rules, so the
pipeline, the tools and the faults can be exercised without Claude. It proves plumbing, not conversation quality.
The call is identified by the `ref:<callId>` line the test system prompt carries.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

REF = re.compile(r"ref:([A-Za-z0-9_.-]+)")


@dataclass
class MockState:
    ttft_s: float = 0.0
    requests: dict[str, int] = field(default_factory=dict)


def _system_text(body: dict[str, Any]) -> str:
    s = body.get("system")
    if isinstance(s, str):
        return s
    if isinstance(s, list):
        return " ".join(b.get("text", "") for b in s if isinstance(b, dict))
    return ""


def call_ref(body: dict[str, Any]) -> str:
    m = REF.search(_system_text(body))
    return m.group(1) if m else "unknown"


# ── the mock brain ──

def _blocks(msg: dict[str, Any]) -> list[dict[str, Any]]:
    c = msg.get("content")
    if isinstance(c, str):
        return [{"type": "text", "text": c}]
    return [b for b in c if isinstance(b, dict)] if isinstance(c, list) else []


def _texts(msg: dict[str, Any]) -> str:
    return " ".join(b.get("text", "") for b in _blocks(msg) if b.get("type") == "text").strip()


BUSINESS = re.compile(r"(?:I own|own|called|shop is|store is|business is)\s+([A-Z][\w']*(?:\s+[A-Z][\w']*)*)")
LANGS = {"tamil": "ta", "hindi": "hi", "telugu": "te", "kannada": "kn", "malayalam": "ml", "marathi": "mr",
         "bengali": "bn", "gujarati": "gu", "english": "en"}
LONG = ("Sure. A Showcase website is a simple, good-looking site for your shop: your name and story, your products "
        "with photos, your opening hours, a map to find you, and buttons to call you or message you on WhatsApp. "
        "We build the first version on this call, you see it on your phone straight away, and you can ask for "
        "changes any time. It works well on mobile, it shows up when people search for you, and you can update it "
        "yourself later from your phone.")


def mock_reply(body: dict[str, Any]) -> dict[str, Any]:
    """{"text": str} or {"tool": name, "input": {...}} from the conversation so far (stateless and deterministic)."""
    msgs = [m for m in body.get("messages") or [] if isinstance(m, dict)]
    if not msgs:
        return {"text": "Hello?"}
    last = msgs[-1]
    user_texts = [_texts(m) for m in msgs if m.get("role") == "user"]
    tool_names: dict[str, str] = {}
    for m in msgs:
        if m.get("role") == "assistant":
            for b in _blocks(m):
                if b.get("type") == "tool_use":
                    tool_names[str(b.get("id"))] = str(b.get("name"))
    results = [b for b in _blocks(last) if b.get("type") == "tool_result"]
    if last.get("role") == "user" and results:
        r = results[-1]
        name = tool_names.get(str(r.get("tool_use_id")), "")
        content = r.get("content")
        raw = content if isinstance(content, str) else " ".join(b.get("text", "") for b in content or [] if isinstance(b, dict))
        if '"ok": false' in raw.replace("'", '"').lower() or '"ok":false' in raw.replace(" ", "").lower():
            return {"text": "Sorry, that didn't go through on my side. I'll follow up with you on WhatsApp."}
        if name == "recordConsent":
            joined = " ".join(user_texts)
            m = BUSINESS.search(joined)
            return {"tool": "startPreview", "input": {"business_name": (m.group(1).strip() if m else "My Shop")}}
        return {"text": {
            "startPreview": "Lovely, I've started your site. Tell me, what does your business do?",
            "addDetails": "Got it, I've added that. The preview is on WhatsApp now. Would you like to change anything?",
            "requestChange": "Done, I've updated it. Shall I publish it?",
        }.get(name, "Okay.")}
    text = _texts(last)
    t = text.lower()
    if t.startswith("["):
        if "silent for a while" in t:
            return {"text": "Hello? Are you still there?"}
        if "still silent" in t:
            return {"text": "Okay, I'll follow up on WhatsApp. Goodbye!"}
        if "time limit" in t:
            return {"text": "Thanks for your time, goodbye!"}
        # The connected note arrives together with the first user turn: answer that turn.
        text = re.sub(r"^\[[^\]]*\]\s*", "", text)
        t = text.lower()
        if not t:
            return {"text": "Hello?"}
    if any(k in t for k in ("stop calling", "don't call", "do not call", "remove my number")) or re.match(r"^stop\b", t):
        return {"tool": "optOut", "input": {}}
    if re.search(r"\b(real person|robot|bot|ai|human|machine)\b", t):
        return {"text": "I'm Jeffi Stores' AI assistant. I'm calling to build you a free website. Shall we do it now?"}
    for word, code in LANGS.items():
        if word in t and any(k in t for k in ("talk", "speak", "in ", "comfortable")):
            return {"tool": "switchLanguage", "input": {"language": code}}
    if "not interested" in t or t.rstrip(".!").endswith("bye"):
        outcome = "published" if "publishSite" in tool_names.values() else "not_interested"
        return {"tool": "markOutcome", "input": {"outcome": outcome}}
    if any(k in t for k in ("publish", "go live", "go ahead")):
        return {"tool": "publishSite", "input": {}}
    if any(k in t for k in ("whatsapp", "send it", "send the")):
        return {"tool": "recordConsent", "input": {"whatsapp": True, "recording_ack": True}}
    if any(k in t for k in ("change", "colour", "color", "warmer", "bigger")):
        return {"tool": "requestChange", "input": {"instruction": text}}
    if any(k in t for k in ("in detail", "explain", "tell me more")):
        return {"text": LONG}
    if any(k in t for k in ("cost", "price", "how much")):
        return {"text": "It's free for seven days, then a small monthly fee, and you can cancel any time."}
    if any(k in t for k in ("we make", "we sell", "we do", "open from", "customers")):
        return {"tool": "addDetails", "input": {"what_they_do": text}}
    if BUSINESS.search(text) or "this is" in t:
        return {"text": "Nice to meet you! We'd like to build you a free website right now, on this call. "
                        "Can I send the preview to you on WhatsApp?"}
    if any(k in t for k in ("who is this", "who's calling", "hello")):
        return {"text": "I'm Priya from Jeffi Stores. We build free websites for local shops. Do you have two minutes?"}
    return {"text": "Okay. Tell me a little about your business."}


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


def mock_stream(reply: dict[str, Any], model: str, input_tokens: int) -> list[bytes]:
    msg_id = f"msg_e2e_{uuid.uuid4().hex[:12]}"
    usage0 = {"input_tokens": input_tokens, "output_tokens": 1, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    out = [_sse("message_start", {"type": "message_start", "message": {
        "id": msg_id, "type": "message", "role": "assistant", "content": [], "model": model,
        "stop_reason": None, "stop_sequence": None, "usage": usage0}})]
    if "tool" in reply:
        args = json.dumps(reply.get("input") or {})
        out.append(_sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {
            "type": "tool_use", "id": f"toolu_e2e_{uuid.uuid4().hex[:12]}", "name": reply["tool"], "input": {}}}))
        out.append(_sse("content_block_delta", {"type": "content_block_delta", "index": 0,
                                                "delta": {"type": "input_json_delta", "partial_json": args}}))
        stop, n_out = "tool_use", max(1, len(args) // 4)
    else:
        text = str(reply.get("text") or "")
        out.append(_sse("content_block_start", {"type": "content_block_start", "index": 0,
                                                "content_block": {"type": "text", "text": ""}}))
        words = text.split(" ")
        for i in range(0, len(words), 4):
            chunk = " ".join(words[i : i + 4]) + (" " if i + 4 < len(words) else "")
            out.append(_sse("content_block_delta", {"type": "content_block_delta", "index": 0,
                                                    "delta": {"type": "text_delta", "text": chunk}}))
        stop, n_out = "end_turn", max(1, len(text) // 4)
    out.append(_sse("content_block_stop", {"type": "content_block_stop", "index": 0}))
    out.append(_sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                                      "usage": {"output_tokens": n_out}}))
    out.append(_sse("message_stop", {"type": "message_stop"}))
    return out


def create_mock_llm(state: MockState) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.post("/{path:path}")
    async def messages(path: str, request: Request) -> Response:
        raw = await request.body()
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            return JSONResponse({"type": "error", "error": {"type": "invalid_request_error", "message": "bad json"}}, status_code=400)
        call_id = call_ref(body)
        state.requests[call_id] = state.requests.get(call_id, 0) + 1
        chunks = mock_stream(mock_reply(body), str(body.get("model") or "mock"), max(1, len(raw) // 4))

        async def gen():  # type: ignore[no-untyped-def]
            if state.ttft_s:
                await asyncio.sleep(state.ttft_s)
            for c in chunks:
                yield c

        return StreamingResponse(gen(), media_type="text/event-stream")

    return app


def mock_lines() -> list[str]:
    """Every line the brain can say (the harness pre-renders them so the mock TTS adds no synthesis time)."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(mock_reply))
    out = [LONG]
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and k.value == "text" and isinstance(v, ast.Constant) and isinstance(v.value, str):
                    out.append(v.value)
                if isinstance(v, ast.Dict):
                    out += [x.value for x in v.values if isinstance(x, ast.Constant) and isinstance(x.value, str)]
    return [s for s in out if s.strip()]

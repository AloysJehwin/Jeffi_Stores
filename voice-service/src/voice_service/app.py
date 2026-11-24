"""HTTP + WebSocket surface.

controller -> here (service token):  POST /calls, POST /calls/{callId}/hangup
provider -> here (per-call token):   POST /telephony/{provider}/status/{callId}?t=..
media streams:                       WS /ws/exotel?k=..   (Exotel Voicebot applet)
                                     WS /ws/twilio/{callId}/{token}   (Twilio <Connect><Stream>, test calls only)
health:                              GET /healthz
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import parse_qsl

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, Response

from .auth import bearer, check_callback_token, verify_service_token
from .config import Settings, bootstrap_env, load_settings
from .controller import ControllerClient
from .log import get_logger, setup_logging
from .provider_config import ProviderConfigSource
from .service import CallService, ServiceError
from .transports.twilio import valid_signature

log = get_logger("voice.app")


def _unauthorized() -> JSONResponse:
    return JSONResponse({"error": "unauthorized"}, status_code=401)


def build_service(settings: Settings) -> CallService:
    from .recording import s3_uploader

    uploader = s3_uploader(settings.aws_region) if settings.s3_bucket else None
    controller = ControllerClient(settings.controller_url, settings.service_secret)
    return CallService(settings, controller, ProviderConfigSource(settings), uploader=uploader)


def create_app(settings: Settings | None = None, service: CallService | None = None, manage: bool = True) -> FastAPI:
    if settings is None:
        bootstrap_env()
        settings = load_settings()
    svc = service or build_service(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
        if manage:
            await svc.start()
        try:
            yield
        finally:
            if manage:
                await svc.stop()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service = svc

    def authed(request: Request) -> bool:
        return verify_service_token(bearer(request.headers.get("authorization")), settings.service_secret) is not None

    @app.get("/healthz")
    async def healthz() -> dict[str, Any]:
        return {"ok": True, "activeCalls": svc.registry.active_count(), "maxConcurrentCalls": settings.max_concurrent_calls}

    @app.post("/calls")
    async def place_call(request: Request) -> Response:
        if not authed(request):
            return _unauthorized()
        try:
            body = await request.json()
        except ValueError:
            return JSONResponse({"error": "invalid json"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid body"}, status_code=400)
        try:
            out = await svc.place(
                str(body.get("callId") or ""),
                str(body.get("to") or ""),
                str(body.get("from") or ""),
                str(body.get("language") or "en"),
            )
        except ServiceError as e:
            return JSONResponse({"error": str(e), **e.detail}, status_code=e.status)
        return JSONResponse(out, status_code=200)

    @app.post("/calls/{call_id}/hangup")
    async def hangup(call_id: str, request: Request) -> Response:
        if not authed(request):
            return _unauthorized()
        out = await svc.hangup(call_id)
        return JSONResponse(out, status_code=200 if out.get("ok") else 404)

    @app.post("/telephony/{provider}/status/{call_id}")
    async def status_callback(provider: str, call_id: str, request: Request) -> Response:
        if not check_callback_token(settings.service_secret, call_id, request.query_params.get("t")):
            return _unauthorized()
        raw = await request.body()
        ctype = request.headers.get("content-type", "")
        payload: dict[str, Any]
        if "json" in ctype:
            try:
                parsed = json.loads(raw or b"{}")
            except ValueError:
                return JSONResponse({"error": "invalid json"}, status_code=400)
            payload = parsed if isinstance(parsed, dict) else {}
        else:
            payload = dict(parse_qsl(raw.decode(errors="replace"), keep_blank_values=True))
        if provider == "twilio":
            rt = svc.runtimes.get(call_id)
            token = rt.cfg.twilio_auth_token if rt else ""
            sig = request.headers.get("x-twilio-signature")
            # Signed over the public URL Twilio called (TLS ends at the edge, so request.url is the inner one).
            query = f"?{request.url.query}" if request.url.query else ""
            public_url = f"{settings.public_base_url}{request.url.path}{query}"
            if token and not valid_signature(token, public_url, payload, sig):
                log.warning("twilio signature mismatch", callId=call_id)
                return _unauthorized()
        await svc.on_status(call_id, payload)
        return Response(status_code=204)

    @app.websocket("/ws/exotel")
    async def exotel_stream(websocket: WebSocket) -> None:
        if settings.ws_key and websocket.query_params.get("k") != settings.ws_key:
            await websocket.close(code=1008)
            return
        await _stream(websocket, expect_call_id=None)

    @app.websocket("/ws/twilio/{call_id}/{token}")
    async def twilio_stream(websocket: WebSocket, call_id: str, token: str) -> None:
        if not check_callback_token(settings.service_secret, call_id, token):
            await websocket.close(code=1008)
            return
        await _stream(websocket, expect_call_id=call_id)

    async def _stream(websocket: WebSocket, expect_call_id: str | None) -> None:
        from pipecat.runner.utils import parse_telephony_websocket

        await websocket.accept()
        try:
            _kind, data = await parse_telephony_websocket(websocket)
        except Exception:  # noqa: BLE001
            await websocket.close(code=1003)
            return
        provider_call_id = str(data.get("call_id") or "")
        stream_id = str(data.get("stream_id") or "")
        call = await svc.find_streamed_call(provider_call_id) if provider_call_id else None
        if call is None or (expect_call_id and call.call_id != expect_call_id):
            log.warning("stream for an unknown call refused", callId=expect_call_id)
            await websocket.close(code=1008)
            return
        await svc.run_stream(websocket, call, stream_id)

    return app


def main() -> None:
    import uvicorn

    bootstrap_env()
    settings = load_settings()
    setup_logging(settings.log_level)
    uvicorn.run(create_app(settings), host="0.0.0.0", port=8080, log_config=None, access_log=False, ws_ping_interval=20)


if __name__ == "__main__":
    main()

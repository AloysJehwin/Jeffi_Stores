"""Starts voice-service the way its own main() does (create_app + uvicorn, same ws ping), with the harness's edges
(voice_patches). Run by the harness as a subprocess:

  python -m e2e.serve_voice --port P --phone-url U --stub-url U --mock-llm-url U --stt mock|real --tts mock|real --llm mock|real

Its env carries the service secret, CONTROLLER_URL (the stub), PUBLIC_BASE_URL, VOICE_WS_KEY, VOICE_STATE_DIR,
dummy Exotel settings, and for real providers SARVAM_API_KEY and the Claude WIF variables. ANTHROPIC_API_KEY,
ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL are always removed (they shadow federation).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VOICE_SRC = HERE.parent.parent.parent / "voice-service" / "src"
for p in (str(VOICE_SRC), str(HERE.parent)):
    if p not in sys.path:
        sys.path.insert(0, p)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--phone-url", required=True)
    ap.add_argument("--stub-url", required=True)
    ap.add_argument("--mock-llm-url", required=True)
    ap.add_argument("--stt", choices=("mock", "real"), default="mock")
    ap.add_argument("--tts", choices=("mock", "real"), default="mock")
    ap.add_argument("--llm", choices=("mock", "real"), default="mock")
    ap.add_argument("--recordings", default="")
    ap.add_argument("--cache-dir", default="")
    ap.add_argument("--force-exotel", action="store_true")
    a = ap.parse_args()

    from e2e import voice_patches

    voice_patches.install(stt=a.stt, tts=a.tts, llm=a.llm, stub_url=a.stub_url, mock_llm_url=a.mock_llm_url,
                          cache_dir=Path(a.cache_dir) if a.cache_dir else None, force_exotel=a.force_exotel)

    import uvicorn
    from voice_service.app import create_app
    from voice_service.config import load_settings
    from voice_service.controller import ControllerClient
    from voice_service.log import setup_logging
    from voice_service.provider_config import ProviderConfigSource
    from voice_service.service import CallService

    settings = load_settings()
    setup_logging(settings.log_level)
    uploader = voice_patches.local_uploader(Path(a.recordings)) if a.recordings else None
    svc = CallService(settings, ControllerClient(settings.controller_url, settings.service_secret),
                      ProviderConfigSource(settings), transport_factory=voice_patches.sim_transport_factory(a.phone_url),
                      uploader=uploader)
    app = create_app(settings, service=svc)
    voice_patches.add_routes(app)
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_config=None, access_log=False, ws_ping_interval=20)


if __name__ == "__main__":
    main()

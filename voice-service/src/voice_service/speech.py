"""Speech engines per call: Sarvam (default) or Azure AI Speech for STT and for TTS, chosen separately.

The chosen engine is tried first; when it can't start (no credentials, the service refuses to build) the other one is
used and the call goes on. A failure after the call has started is not handled here: that is the ProviderWatch's
apology path. Pipecat is imported inside the builders, so nothing loads until a call runs.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from .log import get_logger

if TYPE_CHECKING:
    from .provider_config import VoiceConfig

log = get_logger("voice.speech")

# Azure neural voices, one per supported language (all en-IN and Indic locales Azure ships a standard voice for).
DEFAULT_AZURE_VOICES: dict[str, str] = {
    "en": "en-IN-NeerjaNeural",
    "hi": "hi-IN-SwaraNeural",
    "ta": "ta-IN-PallaviNeural",
    "te": "te-IN-ShrutiNeural",
    "kn": "kn-IN-SapnaNeural",
    "ml": "ml-IN-SobhanaNeural",
    "mr": "mr-IN-AarohiNeural",
    "bn": "bn-IN-TanishaaNeural",
    "gu": "gu-IN-DhwaniNeural",
}

_AZURE_VOICE = re.compile(r"^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z0-9:_-]+Neural$")


def is_azure_voice(name: str) -> bool:
    return bool(_AZURE_VOICE.match(name or ""))


def engine_order(chosen: str, cfg: VoiceConfig) -> list[str]:
    """Engines to try, best first: the chosen one when it has credentials, then the other one. With neither usable,
    just the chosen one (building it then fails loudly; `cfg.missing()` normally refuses the call earlier)."""
    ready = {"sarvam": cfg.sarvam_ready(), "azure": cfg.azure_ready()}
    other = "azure" if chosen == "sarvam" else "sarvam"
    order = [e for e in (chosen, other) if ready[e]]
    return order or [chosen]


def _build_stt(engine: str, cfg: VoiceConfig, settings: Any, language: Any) -> Any:
    if engine == "azure":
        from pipecat.services.azure.stt import AzureSTTService

        return AzureSTTService(
            api_key=cfg.azure_api_key,
            region=cfg.azure_region,
            settings=AzureSTTService.Settings(language=language),
        )
    from pipecat.services.sarvam.stt import SarvamSTTService

    return SarvamSTTService(
        api_key=cfg.sarvam_api_key,
        mode=settings.stt_mode,
        settings=SarvamSTTService.Settings(model=cfg.stt_model or settings.stt_model, language=language),
    )


def azure_voice(cfg: VoiceConfig, language_code: str, persona_voice: str = "") -> str:
    return persona_voice if is_azure_voice(persona_voice) else cfg.azure_voice_for(language_code)


def _build_tts(engine: str, cfg: VoiceConfig, settings: Any, language: Any, language_code: str, persona_voice: str) -> Any:
    if engine == "azure":
        from pipecat.services.azure.tts import AzureTTSService

        return AzureTTSService(
            api_key=cfg.azure_api_key,
            region=cfg.azure_region,
            settings=AzureTTSService.Settings(voice=azure_voice(cfg, language_code, persona_voice), language=language),
        )
    from pipecat.services.sarvam.tts import SarvamTTSService

    tts_settings = SarvamTTSService.Settings(model=cfg.tts_model or settings.tts_model, language=language)
    voice = "" if is_azure_voice(persona_voice) else persona_voice
    voice = voice or cfg.voice_for(language_code)
    if voice:
        tts_settings.voice = voice
    return SarvamTTSService(api_key=cfg.sarvam_api_key, settings=tts_settings)


def _first(kind: str, order: list[str], build: Any) -> tuple[Any, str]:
    failed: Exception | None = None
    for i, engine in enumerate(order):
        try:
            return build(engine), engine
        except Exception as e:  # noqa: BLE001 - any failure to start moves on to the other engine
            failed = e
            log.warning(
                "speech engine failed to start",
                kind=kind,
                engine=engine,
                error=type(e).__name__,
                fallback=order[i + 1] if i + 1 < len(order) else None,
            )
    assert failed is not None
    raise failed


def build_stt(cfg: VoiceConfig, settings: Any, language: Any) -> tuple[Any, str]:
    """(service, engine used)."""
    return _first("stt", engine_order(cfg.stt_provider, cfg), lambda e: _build_stt(e, cfg, settings, language))


def build_tts(cfg: VoiceConfig, settings: Any, language: Any, language_code: str, persona_voice: str = "") -> tuple[Any, str]:
    """(service, engine used)."""
    return _first(
        "tts",
        engine_order(cfg.tts_provider, cfg),
        lambda e: _build_tts(e, cfg, settings, language, language_code, persona_voice),
    )

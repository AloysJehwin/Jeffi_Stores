"""Engine choice per call: Sarvam by default, Azure when chosen, the other one when the chosen can't start.
Nothing connects: the pipecat services are built, never started."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from voice_service import speech
from voice_service.config import Settings, load_settings
from voice_service.provider_config import merge

AZURE = {"azureSpeech": {"region": "centralindia"}}
AZ = {"azure_speech_key": "fake-azure-key"}  # credentials are env-only


def cfg_for(settings: Settings, remote: dict[str, Any] | None = None, **env: Any):
    return merge(remote or {}, replace(settings, **env))


def test_sarvam_is_the_default_engine(settings: Settings) -> None:
    cfg = cfg_for(settings, AZURE, **AZ)
    assert (cfg.stt_provider, cfg.tts_provider) == ("sarvam", "sarvam")
    assert speech.engine_order("sarvam", cfg) == ["sarvam", "azure"]


def test_engine_order_skips_an_engine_without_credentials(settings: Settings) -> None:
    sarvam_only = cfg_for(settings)
    assert speech.engine_order("azure", sarvam_only) == ["sarvam"]
    azure_only = cfg_for(settings, AZURE, sarvam_api_key="", **AZ)
    assert speech.engine_order("sarvam", azure_only) == ["azure"]
    assert speech.engine_order("azure", azure_only) == ["azure"]
    none = cfg_for(settings, sarvam_api_key="")
    assert speech.engine_order("azure", none) == ["azure"]


def test_env_picks_the_engines_and_the_region(monkeypatch: pytest.MonkeyPatch) -> None:
    s = load_settings({"VOICE_STT_PROVIDER": "Azure", "VOICE_TTS_PROVIDER": "nonsense", "AZURE_SPEECH_KEY": "k"})
    assert (s.stt_provider, s.tts_provider, s.azure_speech_region, s.azure_speech_key) == ("azure", "sarvam", "centralindia", "k")
    assert load_settings({"AZURE_SPEECH_REGION": "SouthIndia"}).azure_speech_region == "southindia"


def test_every_language_has_an_azure_neural_voice() -> None:
    from voice_service.pipeline import SUPPORTED_LANGS

    assert set(speech.DEFAULT_AZURE_VOICES) == set(SUPPORTED_LANGS)
    for lang, voice in speech.DEFAULT_AZURE_VOICES.items():
        assert speech.is_azure_voice(voice) and voice.startswith(f"{lang}-IN-")
    assert not speech.is_azure_voice("priya")


def test_azure_voice_prefers_the_controllers_then_the_default(settings: Settings) -> None:
    cfg = cfg_for(settings, {"azureSpeech": {"voices": {"hi": "hi-IN-MadhurNeural"}}})
    assert speech.azure_voice(cfg, "hi") == "hi-IN-MadhurNeural"
    assert speech.azure_voice(cfg, "ta") == "ta-IN-PallaviNeural"
    # a Sarvam speaker id from the session never reaches Azure; an Azure voice id from it does
    assert speech.azure_voice(cfg, "hi", "priya") == "hi-IN-MadhurNeural"
    assert speech.azure_voice(cfg, "hi", "hi-IN-SwaraNeural") == "hi-IN-SwaraNeural"


def lang(code: str) -> Any:
    from voice_service.pipeline import pipecat_language

    return pipecat_language(code)


def test_azure_services_are_built_with_the_region_and_voice(settings: Settings) -> None:
    from pipecat.services.azure.stt import AzureSTTService
    from pipecat.services.azure.tts import AzureTTSService

    cfg = cfg_for(settings, {**AZURE, "speech": {"sttProvider": "azure", "ttsProvider": "azure"}}, **AZ)
    stt, stt_engine = speech.build_stt(cfg, settings, lang("ta"))
    tts, tts_engine = speech.build_tts(cfg, settings, lang("ta"), "ta")
    assert (stt_engine, tts_engine) == ("azure", "azure")
    assert isinstance(stt, AzureSTTService) and isinstance(tts, AzureTTSService)
    assert tts._settings.voice == "ta-IN-PallaviNeural"
    assert str(stt._settings.language) == "ta-IN"


def test_sarvam_services_use_the_session_voice(settings: Settings) -> None:
    from pipecat.services.sarvam.stt import SarvamSTTService
    from pipecat.services.sarvam.tts import SarvamTTSService

    cfg = cfg_for(settings, {"sarvam": {"apiKey": "k", "voices": {"hi": "priya"}}})
    stt, _ = speech.build_stt(cfg, settings, lang("hi"))
    tts, engine = speech.build_tts(cfg, settings, lang("hi"), "hi", "ritu")
    assert isinstance(stt, SarvamSTTService) and isinstance(tts, SarvamTTSService) and engine == "sarvam"
    assert tts._settings.voice == "ritu"
    # an Azure voice id in the session is not a Sarvam speaker: the configured per-language voice is used instead
    tts, _ = speech.build_tts(cfg, settings, lang("hi"), "hi", "hi-IN-SwaraNeural")
    assert tts._settings.voice == "priya"


def test_a_missing_azure_key_falls_back_to_sarvam_without_building_azure(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    tried: list[str] = []
    real = speech._build_stt
    monkeypatch.setattr(speech, "_build_stt", lambda e, *a: (tried.append(e), real(e, *a))[1])
    cfg = cfg_for(settings, {"speech": {"sttProvider": "azure", "ttsProvider": "azure"}})
    _, engine = speech.build_stt(cfg, settings, lang("hi"))
    assert engine == "sarvam" and tried == ["sarvam"]


def test_a_chosen_engine_that_fails_to_start_falls_back_to_the_other(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    real_stt, real_tts = speech._build_stt, speech._build_tts

    def boom_stt(engine: str, *a: Any) -> Any:
        if engine == "azure":
            raise ValueError("Either 'region' or 'private_endpoint' must be provided.")
        return real_stt(engine, *a)

    def boom_tts(engine: str, *a: Any) -> Any:
        if engine == "sarvam":
            raise RuntimeError("sarvam refused")
        return real_tts(engine, *a)

    monkeypatch.setattr(speech, "_build_stt", boom_stt)
    monkeypatch.setattr(speech, "_build_tts", boom_tts)
    cfg = cfg_for(settings, {**AZURE, "speech": {"sttProvider": "azure", "ttsProvider": "sarvam"}}, **AZ)
    assert speech.build_stt(cfg, settings, lang("hi"))[1] == "sarvam"
    assert speech.build_tts(cfg, settings, lang("hi"), "hi")[1] == "azure"


def test_both_engines_failing_raises_the_last_error(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(engine: str, *a: Any) -> Any:
        raise RuntimeError(f"{engine} down")

    monkeypatch.setattr(speech, "_build_stt", boom)
    cfg = cfg_for(settings, AZURE, **AZ)
    with pytest.raises(RuntimeError, match="azure down"):
        speech.build_stt(cfg, settings, lang("hi"))


async def test_the_pipeline_wires_up_with_azure_engines(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import MagicMock

    from pipecat.serializers.exotel import ExotelFrameSerializer
    from pipecat.services.azure.stt import AzureSTTService
    from pipecat.services.azure.tts import AzureTTSService
    from test_pipeline import runtime

    from voice_service import pipeline as pl

    built: list[Any] = []
    real = pl.build_stt
    monkeypatch.setattr(pl, "build_stt", lambda *a: built.append(real(*a)) or built[-1])
    rt = runtime(settings, persona={"name": "Priya", "voiceId": "priya"})
    rt.cfg = cfg_for(settings, {**AZURE, "speech": {"sttProvider": "azure", "ttsProvider": "azure"}}, **AZ)
    rt.worker = None
    pl.build_pipeline(MagicMock(), rt, ExotelFrameSerializer(stream_sid="s1", call_sid="c1"))
    assert isinstance(built[0][0], AzureSTTService) and built[0][1] == "azure"
    assert isinstance(rt.tts, AzureTTSService) and rt.tts._settings.voice == "hi-IN-SwaraNeural"

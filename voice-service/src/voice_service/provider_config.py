"""Provider config: admin Settings -> Providers (the controller's voice-config endpoint) first, env as the fallback.

GET {CONTROLLER_URL}/api/internal/outreach/voice-config is fetched when a call starts and cached for 60 s in memory
only (never written to disk, never logged). Each field falls back to its env var when the endpoint is unreachable or
leaves it empty. With neither, `missing()` names what is absent and calls are refused.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from .auth import outbound_token
from .config import Settings, normalize_number, speech_engine
from .llm_client import token_file_ok
from .log import get_logger

log = get_logger("voice.provider_config")

PROVIDER_ALIASES = {"exotel": "exotel", "twilio_test": "twilio", "twilio": "twilio"}


@dataclass(frozen=True)
class AnthropicIdentity:
    organization_id: str = ""
    workspace_id: str = ""
    service_account_id: str = ""
    federation_rule_id: str = ""

    def absent(self) -> list[str]:
        need = {
            "organizationId": self.organization_id,
            "workspaceId": self.workspace_id,
            "serviceAccountId": self.service_account_id,
            "federationRuleId": self.federation_rule_id,
        }
        return [f"anthropic.identity.{k}" for k, v in need.items() if not v]

    def any(self) -> bool:
        return len(self.absent()) < 4


@dataclass(frozen=True)
class VoiceConfig:
    provider: str
    exotel_sid: str = ""
    exotel_subdomain: str = ""
    exotel_caller_id: str = ""
    exotel_app_id: str = ""
    exotel_api_key: str = ""
    exotel_api_token: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from: str = ""
    test_numbers: frozenset[str] = field(default_factory=frozenset)
    sarvam_api_key: str = ""
    stt_model: str = ""
    tts_model: str = ""
    voices: dict[str, str] = field(default_factory=dict)
    azure_api_key: str = ""
    azure_region: str = ""
    azure_voices: dict[str, str] = field(default_factory=dict)
    stt_provider: str = "sarvam"  # sarvam | azure: the engine tried first; the other is the fallback
    tts_provider: str = "sarvam"
    anthropic_api_key: str = ""
    anthropic_identity: AnthropicIdentity = field(default_factory=AnthropicIdentity)
    anthropic_identity_token_file: str = ""
    llm_model: str = ""
    source: str = "env"  # controller | env
    sources: dict[str, str] = field(default_factory=dict)  # field name -> controller | env (names only, never values)

    def sources_report(self) -> dict[str, list[str]]:
        return {k: sorted(n for n, v in self.sources.items() if v == k) for k in ("controller", "env")}

    def voice_for(self, language: str) -> str:
        base = (language or "").split("-")[0].lower()
        return self.voices.get(language) or self.voices.get(base) or ""

    def azure_voice_for(self, language: str) -> str:
        from .speech import DEFAULT_AZURE_VOICES

        base = (language or "").split("-")[0].lower()
        return self.azure_voices.get(language) or self.azure_voices.get(base) or DEFAULT_AZURE_VOICES.get(base, DEFAULT_AZURE_VOICES["en"])

    def sarvam_ready(self) -> bool:
        return bool(self.sarvam_api_key)

    def azure_ready(self) -> bool:
        return bool(self.azure_api_key and self.azure_region)

    def identity_ready(self) -> bool:
        """Federation is usable: every id set and the token file present."""
        return not self.anthropic_identity.absent() and token_file_ok(self.anthropic_identity_token_file)

    def claude_missing(self) -> list[str]:
        """Empty when federation or a key is usable. A half-configured identity names its gaps."""
        if self.identity_ready() or self.anthropic_api_key:
            return []
        ident = self.anthropic_identity
        gaps = ident.absent()
        if not ident.any() and not self.anthropic_identity_token_file:
            return ["anthropic.identity-or-apiKey"]
        if not self.anthropic_identity_token_file:
            gaps.append("anthropic.identityTokenFile")
        elif not gaps:
            gaps.append("anthropic.identityTokenFile (file not found)")
        return gaps

    def missing(self) -> list[str]:
        need: dict[str, str] = {}
        if not (self.sarvam_ready() or self.azure_ready()):
            # One usable speech engine is enough (the other is only the fallback).
            need["sarvam.apiKey"] = ""
            if "azure" in (self.stt_provider, self.tts_provider):
                need["azureSpeech.apiKey"] = ""
        if self.provider == "exotel":
            need |= {
                "exotel.accountSid": self.exotel_sid,
                "exotel.apiKey": self.exotel_api_key,
                "exotel.apiToken": self.exotel_api_token,
                "exotel.appId": self.exotel_app_id,
                "exotel.callerId": self.exotel_caller_id,
            }
        elif self.provider == "twilio":
            need |= {
                "twilio.accountSid": self.twilio_account_sid,
                "twilio.authToken": self.twilio_auth_token,
                "twilio.from": self.twilio_from,
            }
        else:
            need["voice_provider"] = ""
        return sorted([k for k, v in need.items() if not v] + self.claude_missing())


def _get(d: Any, *path: str) -> Any:
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def _s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def merge(remote: dict[str, Any] | None, env: Settings) -> VoiceConfig:
    """Reads the controller's getVoiceConfig() shape (packages/store-core/src/lib/providers/voice-config.ts), field by
    field: the controller's value when non-empty, else the env var. `sources` records which one each field used."""
    r = remote or {}
    sources: dict[str, str] = {}

    def pick(name: str, remote_value: Any, env_value: str) -> str:
        rv = _s(remote_value)
        if rv:
            sources[name] = "controller"
            return rv
        if env_value:
            sources[name] = "env"
        return env_value

    provider = PROVIDER_ALIASES.get(_s(r.get("provider")).lower(), "")
    sources["provider"] = "controller" if provider else "env"
    provider = provider or env.telephony_provider
    remote_numbers = r.get("testNumbers")
    numbers = set(env.test_numbers)
    if isinstance(remote_numbers, list):
        numbers |= {normalize_number(n) for n in remote_numbers if isinstance(n, str) and normalize_number(n)}
        sources["testNumbers"] = "controller"
    elif numbers:
        sources["testNumbers"] = "env"
    voices_raw = _get(r, "sarvam", "voices")
    voices = {k: v.strip() for k, v in voices_raw.items() if isinstance(k, str) and _s(v)} if isinstance(voices_raw, dict) else {}
    if voices:
        sources["sarvam.voices"] = "controller"
    speech_raw = r.get("speech") if isinstance(r.get("speech"), dict) else {}
    stt_provider = speech_engine(speech_raw.get("sttProvider"), "")
    tts_provider = speech_engine(speech_raw.get("ttsProvider"), "")
    if stt_provider or tts_provider:
        sources["speech"] = "controller"
    elif env.stt_provider != "sarvam" or env.tts_provider != "sarvam":
        sources["speech"] = "env"
    azure_voices_raw = _get(r, "azureSpeech", "voices")
    azure_voices = (
        {k: v.strip() for k, v in azure_voices_raw.items() if isinstance(k, str) and _s(v)}
        if isinstance(azure_voices_raw, dict)
        else {}
    )
    if azure_voices:
        sources["azureSpeech.voices"] = "controller"
    ident_raw = r.get("anthropicIdentity") if isinstance(r.get("anthropicIdentity"), dict) else {}

    def ident(key: str, env_value: str) -> str:
        # Env wins here (unlike the rest): the pod's own env names a rule that trusts this pod's issuer, while the
        # controller serves the platform row that the gateway's rule belongs to.
        rv = _s(ident_raw.get(key))
        if env_value:
            sources[f"anthropicIdentity.{key}"] = "env"
        elif rv:
            sources[f"anthropicIdentity.{key}"] = "controller"
        return env_value or rv

    identity = AnthropicIdentity(
        organization_id=ident("organizationId", env.anthropic_organization_id),
        workspace_id=ident("workspaceId", env.anthropic_workspace_id),
        service_account_id=ident("serviceAccountId", env.anthropic_service_account_id),
        federation_rule_id=ident("federationRuleId", env.anthropic_federation_rule_id),
    )
    return VoiceConfig(
        provider=provider,
        exotel_sid=pick("exotel.accountSid", _get(r, "exotel", "accountSid"), env.exotel_sid),
        exotel_subdomain=pick("exotel.subdomain", _get(r, "exotel", "subdomain"), env.exotel_subdomain),
        exotel_caller_id=normalize_number(pick("exotel.callerId", _get(r, "exotel", "callerId"), env.exotel_caller_id)),
        exotel_app_id=pick("exotel.appId", _get(r, "exotel", "appId"), env.exotel_app_id),
        exotel_api_key=pick("exotel.apiKey", _get(r, "exotel", "apiKey"), env.exotel_api_key),
        exotel_api_token=pick("exotel.apiToken", _get(r, "exotel", "apiToken"), env.exotel_api_token),
        twilio_account_sid=pick("twilioTest.accountSid", _get(r, "twilioTest", "accountSid"), env.twilio_account_sid),
        twilio_auth_token=pick("twilioTest.authToken", _get(r, "twilioTest", "authToken"), env.twilio_auth_token),
        twilio_from=normalize_number(pick("twilioTest.from", _get(r, "twilioTest", "from"), env.twilio_voice_from)),
        test_numbers=frozenset(numbers),
        sarvam_api_key=pick("sarvam.apiKey", _get(r, "sarvam", "apiKey"), env.sarvam_api_key),
        stt_model=pick("sarvam.sttModel", _get(r, "sarvam", "sttModel"), env.stt_model),
        tts_model=pick("sarvam.ttsModel", _get(r, "sarvam", "ttsModel"), env.tts_model),
        voices=voices,
        azure_api_key=pick("azureSpeech.apiKey", _get(r, "azureSpeech", "apiKey"), env.azure_speech_key),
        azure_region=pick("azureSpeech.region", _get(r, "azureSpeech", "region"), env.azure_speech_region).lower(),
        azure_voices=azure_voices,
        stt_provider=stt_provider or env.stt_provider,
        tts_provider=tts_provider or env.tts_provider,
        anthropic_api_key=pick("anthropic.apiKey", _get(r, "anthropic", "apiKey"), env.anthropic_api_key),
        anthropic_identity=identity,
        anthropic_identity_token_file=env.anthropic_identity_token_file,
        llm_model=pick("llmModel", r.get("llmModel"), env.llm_model),
        source="controller" if remote else "env",
        sources=dict(sources),
    )


class ProviderConfigSource:
    def __init__(
        self,
        settings: Settings,
        http: httpx.AsyncClient | None = None,
        ttl_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._http = http or httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0))
        self._ttl = ttl_s
        self._clock = clock
        self._cached: dict[str, Any] | None = None
        self._cached_at = 0.0

    def invalidate(self) -> None:
        self._cached, self._cached_at = None, 0.0

    async def _fetch(self) -> dict[str, Any] | None:
        s = self._settings
        if not s.controller_url or not s.service_secret:
            return None
        try:
            r = await self._http.get(
                f"{s.controller_url}/api/internal/outreach/voice-config",
                headers={"authorization": f"Bearer {outbound_token(s.service_secret)}", "cache-control": "no-store"},
            )
        except httpx.HTTPError as e:
            log.warning("voice-config unreachable; using env", error=type(e).__name__)
            return None
        if r.status_code != 200:
            log.warning("voice-config refused; using env", status=r.status_code)
            return None
        try:
            body = r.json()
        except ValueError:
            log.warning("voice-config not json; using env")
            return None
        return body if isinstance(body, dict) else None

    async def get(self) -> VoiceConfig:
        now = self._clock()
        if self._cached is None or now - self._cached_at >= self._ttl:
            fetched = await self._fetch()
            if fetched is not None:
                self._cached, self._cached_at = fetched, now
            else:
                self._cached, self._cached_at = None, 0.0
        return merge(self._cached, self._settings)

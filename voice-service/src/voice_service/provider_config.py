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
from .config import Settings, normalize_number
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
    anthropic_api_key: str = ""
    anthropic_identity: AnthropicIdentity = field(default_factory=AnthropicIdentity)
    anthropic_identity_token_file: str = ""
    llm_model: str = ""
    source: str = "env"  # controller | env

    def voice_for(self, language: str) -> str:
        base = (language or "").split("-")[0].lower()
        return self.voices.get(language) or self.voices.get(base) or ""

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
        need: dict[str, str] = {"sarvam.apiKey": self.sarvam_api_key}
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
    """Field by field: the controller's value when non-empty, else the env var."""
    r = remote or {}
    cfg = r.get("voice_config") if isinstance(r.get("voice_config"), dict) else {}
    sec = r.get("secrets") if isinstance(r.get("secrets"), dict) else {}

    def pick(remote_value: Any, env_value: str) -> str:
        return _s(remote_value) or env_value

    provider = PROVIDER_ALIASES.get(_s(r.get("voice_provider")).lower(), "") or env.telephony_provider
    remote_numbers = _get(cfg, "testNumbers")
    numbers = set(env.test_numbers)
    if isinstance(remote_numbers, list):
        numbers |= {normalize_number(n) for n in remote_numbers if isinstance(n, str) and normalize_number(n)}
    voices_raw = _get(cfg, "sarvam", "voices")
    voices = {k: v for k, v in voices_raw.items() if isinstance(k, str) and _s(v)} if isinstance(voices_raw, dict) else {}
    ident_raw = r.get("anthropicIdentity") if isinstance(r.get("anthropicIdentity"), dict) else {}
    # Env wins here (unlike the keys): the pod's own env names a rule that trusts this pod's issuer, while the
    # controller serves the platform row that the gateway's rule belongs to.
    identity = AnthropicIdentity(
        organization_id=env.anthropic_organization_id or _s(_get(ident_raw, "organizationId")),
        workspace_id=env.anthropic_workspace_id or _s(_get(ident_raw, "workspaceId")),
        service_account_id=env.anthropic_service_account_id or _s(_get(ident_raw, "serviceAccountId")),
        federation_rule_id=env.anthropic_federation_rule_id or _s(_get(ident_raw, "federationRuleId")),
    )
    return VoiceConfig(
        provider=provider,
        exotel_sid=pick(_get(cfg, "exotel", "accountSid"), env.exotel_sid),
        exotel_subdomain=pick(_get(cfg, "exotel", "subdomain"), env.exotel_subdomain),
        exotel_caller_id=normalize_number(pick(_get(cfg, "exotel", "callerId"), env.exotel_caller_id)),
        exotel_app_id=pick(_get(cfg, "exotel", "appId"), env.exotel_app_id),
        exotel_api_key=pick(_get(sec, "exotel", "apiKey"), env.exotel_api_key),
        exotel_api_token=pick(_get(sec, "exotel", "apiToken"), env.exotel_api_token),
        twilio_account_sid=pick(_get(sec, "twilio_voice", "accountSid"), env.twilio_account_sid),
        twilio_auth_token=pick(_get(sec, "twilio_voice", "authToken"), env.twilio_auth_token),
        twilio_from=normalize_number(pick(_get(cfg, "twilioTest", "from"), env.twilio_voice_from)),
        test_numbers=frozenset(numbers),
        sarvam_api_key=pick(_get(sec, "sarvam", "apiKey"), env.sarvam_api_key),
        stt_model=pick(_get(cfg, "sarvam", "sttModel"), env.stt_model),
        tts_model=pick(_get(cfg, "sarvam", "ttsModel"), env.tts_model),
        voices=voices,
        anthropic_api_key=pick(_get(sec, "anthropic_voice", "apiKey"), env.anthropic_api_key),
        anthropic_identity=identity,
        anthropic_identity_token_file=env.anthropic_identity_token_file,
        llm_model=pick(_get(cfg, "llmModel"), env.llm_model),
        source="controller" if remote else "env",
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

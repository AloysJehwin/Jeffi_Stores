"""Env-driven settings. No secrets in code: keys come from the environment (a k8s Secret in the cluster)."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field

PROVIDERS = ("exotel", "twilio")
SPEECH_ENGINES = ("sarvam", "azure")
DEFAULT_AZURE_REGION = "centralindia"


def _num(env: Mapping[str, str], key: str, default: float) -> float:
    raw = env.get(key, "").strip()
    return float(raw) if raw else default


def _int(env: Mapping[str, str], key: str, default: int) -> int:
    return int(_num(env, key, default))


def speech_engine(raw: object, default: str = "sarvam") -> str:
    v = raw.strip().lower() if isinstance(raw, str) else ""
    return v if v in SPEECH_ENGINES else default


def parse_numbers(raw: str) -> frozenset[str]:
    """Comma/space separated E.164 numbers, normalised (spaces and dashes dropped)."""
    out = set()
    for part in raw.replace(";", ",").replace(" ", ",").split(","):
        n = normalize_number(part)
        if n:
            out.add(n)
    return frozenset(out)


def normalize_number(raw: str | None) -> str:
    if not raw:
        return ""
    s = "".join(ch for ch in raw.strip() if ch.isdigit() or ch == "+")
    return s


@dataclass(frozen=True)
class Settings:
    telephony_provider: str = "exotel"
    public_base_url: str = ""
    controller_url: str = ""
    service_secret: str = ""
    max_concurrent_calls: int = 2
    test_numbers: frozenset[str] = field(default_factory=frozenset)
    # Telephony timing.
    ring_timeout_s: int = 35
    max_call_ceiling_s: int = 900
    # Speech + LLM.
    sarvam_api_key: str = ""
    # Azure AI Speech: the alternative STT/TTS engine, and Sarvam's fallback.
    azure_speech_key: str = ""
    azure_speech_region: str = DEFAULT_AZURE_REGION
    stt_provider: str = "sarvam"
    tts_provider: str = "sarvam"
    anthropic_api_key: str = ""
    # Claude via workload identity federation (preferred over the key); the token file is renewed by a sidecar.
    anthropic_organization_id: str = ""
    anthropic_workspace_id: str = ""
    anthropic_service_account_id: str = ""
    anthropic_federation_rule_id: str = ""
    anthropic_identity_token_file: str = ""
    llm_model: str = "claude-haiku-5-5"
    llm_effort: str = "low"
    llm_max_tokens: int = 400
    stt_model: str = "saaras:v3"
    stt_mode: str = "transcribe"
    tts_model: str = "bulbul:v3"
    # Turn-taking knobs (README: latency tuning).
    vad_start_s: float = 0.2
    turn_silence_s: float = 0.48
    turn_max_wait_s: float = 2.0
    greeting_delay_s: float = 0.4
    filler_after_s: float = 1.8
    dead_air_s: float = 3.0
    voicemail_window_s: float = 8.0
    tool_timeout_s: float = 20.0
    # Provider watch (conversation.ProviderWatch).
    llm_first_token_s: float = 8.0
    stt_miss_speech_s: float = 1.5
    # Exotel.
    exotel_sid: str = ""
    exotel_api_key: str = ""
    exotel_api_token: str = ""
    exotel_subdomain: str = "api.in.exotel.com"
    exotel_app_id: str = ""
    exotel_caller_id: str = ""
    # Twilio (test calls only).
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_voice_from: str = ""
    # Recording.
    s3_bucket: str = ""
    s3_key_prefix: str = ""
    aws_region: str = "ap-south-1"
    # Process.
    state_dir: str = "/tmp/voice-service"
    ws_key: str = ""
    log_level: str = "INFO"

    @property
    def ws_base_url(self) -> str:
        base = self.public_base_url.rstrip("/")
        if base.startswith("https://"):
            return "wss://" + base[len("https://") :]
        if base.startswith("http://"):
            return "ws://" + base[len("http://") :]
        return base

    def missing_base(self) -> list[str]:
        """Env the service itself needs (provider keys come from provider_config); /calls refuses while missing."""
        need = {
            "PUBLIC_BASE_URL": self.public_base_url,
            "CONTROLLER_URL": self.controller_url,
            "SERVICE_AUTH_SECRET": self.service_secret,
        }
        return sorted(k for k, v in need.items() if not v)


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    e = dict(os.environ if env is None else env)
    provider = e.get("TELEPHONY_PROVIDER", "exotel").strip().lower() or "exotel"
    if provider not in PROVIDERS:
        raise ValueError(f"TELEPHONY_PROVIDER must be one of {', '.join(PROVIDERS)}")
    return Settings(
        telephony_provider=provider,
        public_base_url=e.get("PUBLIC_BASE_URL", "").rstrip("/"),
        controller_url=e.get("CONTROLLER_URL", "").rstrip("/"),
        # The repo's shared service-to-service secret (packages/service-auth); SERVICE_TOKEN_SECRET is an alias.
        service_secret=e.get("SERVICE_AUTH_SECRET") or e.get("SERVICE_TOKEN_SECRET", ""),
        max_concurrent_calls=max(1, _int(e, "MAX_CONCURRENT_CALLS", 2)),
        test_numbers=parse_numbers(e.get("TEST_NUMBERS", "")),
        ring_timeout_s=_int(e, "VOICE_RING_TIMEOUT_S", 35),
        max_call_ceiling_s=_int(e, "VOICE_MAX_CALL_S", 900),
        sarvam_api_key=e.get("SARVAM_API_KEY", ""),
        azure_speech_key=e.get("AZURE_SPEECH_KEY", "").strip(),
        azure_speech_region=e.get("AZURE_SPEECH_REGION", "").strip().lower() or DEFAULT_AZURE_REGION,
        stt_provider=speech_engine(e.get("VOICE_STT_PROVIDER")),
        tts_provider=speech_engine(e.get("VOICE_TTS_PROVIDER")),
        anthropic_api_key=e.get("ANTHROPIC_API_KEY", ""),
        anthropic_organization_id=e.get("ANTHROPIC_ORGANIZATION_ID", "").strip(),
        anthropic_workspace_id=e.get("ANTHROPIC_WORKSPACE_ID", "").strip(),
        anthropic_service_account_id=e.get("ANTHROPIC_SERVICE_ACCOUNT_ID", "").strip(),
        anthropic_federation_rule_id=e.get("ANTHROPIC_FEDERATION_RULE_ID", "").strip(),
        anthropic_identity_token_file=e.get("ANTHROPIC_IDENTITY_TOKEN_FILE", "").strip(),
        llm_model=e.get("VOICE_LLM_MODEL", "") or "claude-haiku-5-5",
        llm_effort=e.get("VOICE_LLM_EFFORT", "") or "low",
        llm_max_tokens=_int(e, "VOICE_LLM_MAX_TOKENS", 400),
        stt_model=e.get("VOICE_STT_MODEL", "") or "saaras:v3",
        stt_mode=e.get("VOICE_STT_MODE", "") or "transcribe",
        tts_model=e.get("VOICE_TTS_MODEL", "") or "bulbul:v3",
        vad_start_s=_num(e, "VOICE_VAD_START_S", 0.2),
        turn_silence_s=_num(e, "VOICE_TURN_SILENCE_S", 0.48),
        turn_max_wait_s=_num(e, "VOICE_TURN_MAX_WAIT_S", 2.0),
        greeting_delay_s=_num(e, "VOICE_GREETING_DELAY_S", 0.4),
        filler_after_s=_num(e, "VOICE_FILLER_AFTER_S", 1.8),
        dead_air_s=_num(e, "VOICE_DEAD_AIR_S", 3.0),
        voicemail_window_s=_num(e, "VOICE_VOICEMAIL_WINDOW_S", 8.0),
        tool_timeout_s=_num(e, "VOICE_TOOL_TIMEOUT_S", 20.0),
        llm_first_token_s=_num(e, "VOICE_LLM_FIRST_TOKEN_S", 8.0),
        stt_miss_speech_s=_num(e, "VOICE_STT_MISS_SPEECH_S", 1.5),
        exotel_sid=e.get("EXOTEL_SID", ""),
        exotel_api_key=e.get("EXOTEL_API_KEY", ""),
        exotel_api_token=e.get("EXOTEL_API_TOKEN", ""),
        exotel_subdomain=e.get("EXOTEL_SUBDOMAIN", "") or "api.in.exotel.com",
        exotel_app_id=e.get("EXOTEL_APP_ID", ""),
        exotel_caller_id=normalize_number(e.get("EXOTEL_CALLER_ID", "")),
        twilio_account_sid=e.get("TWILIO_ACCOUNT_SID", ""),
        twilio_auth_token=e.get("TWILIO_AUTH_TOKEN", ""),
        twilio_voice_from=normalize_number(e.get("TWILIO_VOICE_FROM", "")),
        s3_bucket=e.get("S3_BUCKET") or e.get("S3_BUCKET_NAME", ""),
        s3_key_prefix=e.get("S3_KEY_PREFIX", "").strip("/"),
        aws_region=e.get("AWS_REGION") or e.get("AWS_DEFAULT_REGION", "") or "ap-south-1",
        state_dir=e.get("VOICE_STATE_DIR", "") or "/tmp/voice-service",
        ws_key=e.get("VOICE_WS_KEY", ""),
        log_level=(e.get("LOG_LEVEL", "") or "INFO").upper(),
    )


def load_secret_env(secret_id: str, region: str | None = None) -> dict[str, str]:
    """Optional: read a Secrets Manager JSON secret (SM_SECRET_ID), like the Node services do."""
    import boto3

    client = boto3.client("secretsmanager", region_name=region)
    raw = client.get_secret_value(SecretId=secret_id)["SecretString"]
    return {k: v for k, v in json.loads(raw).items() if isinstance(v, str)}


def bootstrap_env() -> None:
    """Fill missing env keys from SM_SECRET_ID when it is set; explicit env always wins."""
    secret_id = os.environ.get("SM_SECRET_ID")
    if not secret_id:
        return
    for k, v in load_secret_env(secret_id, os.environ.get("AWS_REGION") or None).items():
        os.environ.setdefault(k, v)

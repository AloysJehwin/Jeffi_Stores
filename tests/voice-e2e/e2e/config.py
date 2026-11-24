"""Paths, keys and price assumptions for the voice E2E harness.

Keys come from a private file outside the repo, ~/.jeffi/voice-e2e.env (mode 600), with voice-service/.env.e2e.local
(gitignored) as an optional override. Claude is reached through workload identity federation (the ANTHROPIC_* WIF
variables), never an API key. Nothing here is ever printed, logged or written: `Keys.__repr__` says only what is set.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent.parent
ROOT = HARNESS_DIR.parent.parent
VOICE_DIR = ROOT / "voice-service"
VOICE_SRC = VOICE_DIR / "src"
KEYS_FILE = Path(os.environ.get("JEFFI_VOICE_E2E_ENV") or Path.home() / ".jeffi" / "voice-e2e.env")
ENV_OVERRIDE = VOICE_DIR / ".env.e2e.local"
CACHE_DIR = HARNESS_DIR / "cache"
OUT_DIR = HARNESS_DIR / "out"
WIF_MINT = ROOT / "ai-platform" / "scripts" / "local-wif-token.mjs"

DEFAULT_LLM_MODEL = "claude-haiku-5-5"
WIF_VARS = ("ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_WORKSPACE_ID", "ANTHROPIC_SERVICE_ACCOUNT_ID",
            "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_IDENTITY_TOKEN_FILE", "ANTHROPIC_IDENTITY_TOKEN")
# Never handed to voice-service: each one shadows federation (a Claude Code shell sets ANTHROPIC_AUTH_TOKEN).
SHADOWING_VARS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_PROFILE")


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        out[k] = v
    return out


@dataclass(frozen=True)
class Keys:
    sarvam: str = ""
    wif: dict[str, str] = field(default_factory=dict)
    llm_model: str = DEFAULT_LLM_MODEL

    @property
    def claude_ready(self) -> bool:
        w = self.wif
        has_token = bool(w.get("ANTHROPIC_IDENTITY_TOKEN")) or bool(w.get("ANTHROPIC_IDENTITY_TOKEN_FILE"))
        return bool(w.get("ANTHROPIC_FEDERATION_RULE_ID") and w.get("ANTHROPIC_ORGANIZATION_ID") and has_token)

    def token_age_s(self) -> float | None:
        f = self.wif.get("ANTHROPIC_IDENTITY_TOKEN_FILE")
        if not f:
            return None
        p = Path(f).expanduser()
        return time.time() - p.stat().st_mtime if p.exists() else None

    def missing(self) -> list[str]:
        out = [] if self.sarvam else ["SARVAM_API_KEY"]
        if not self.claude_ready:
            out.append("Claude WIF (ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_IDENTITY_TOKEN_FILE)")
        return out

    def claude_env(self) -> dict[str, str]:
        return {k: v for k, v in self.wif.items() if v}

    def __repr__(self) -> str:  # never the values
        return (f"Keys(sarvam={'set' if self.sarvam else 'unset'}, claude_wif={'set' if self.claude_ready else 'unset'}, "
                f"model={self.llm_model})")

    __str__ = __repr__


def load_keys(path: Path = KEYS_FILE, override: Path = ENV_OVERRIDE) -> Keys:
    env = {**parse_env_file(path), **{k: v for k, v in parse_env_file(override).items() if v}}
    return Keys(
        sarvam=env.get("SARVAM_API_KEY", ""),
        wif={k: env[k] for k in WIF_VARS if env.get(k)},
        llm_model=env.get("VOICE_LLM_MODEL", "") or DEFAULT_LLM_MODEL,
    )


def _rate(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Rates:
    """Estimates only (voice-service/README.md cost model; check current price sheets). Override with env."""

    stt_inr_per_min: float = _rate("E2E_RATE_STT_INR_PER_MIN", 0.5)  # Sarvam saaras streaming, ~Rs 30 per audio hour
    tts_inr_per_1k_chars: float = _rate("E2E_RATE_TTS_INR_PER_1K_CHARS", 1.5)  # Sarvam bulbul, ~350 chars/min ~ Rs 0.5
    # Claude Haiku 5.5, USD per million tokens (prompts up to 100K tokens).
    llm_in_usd_per_mtok: float = _rate("E2E_RATE_LLM_IN_USD_PER_MTOK", 0.10)
    llm_out_usd_per_mtok: float = _rate("E2E_RATE_LLM_OUT_USD_PER_MTOK", 0.50)
    llm_cache_write_mult: float = 1.25
    llm_cache_read_mult: float = 0.10
    usd_inr: float = _rate("E2E_USD_INR", 88.0)
    telephony_inr_per_min: float = _rate("E2E_RATE_TELEPHONY_INR_PER_MIN", 0.9)  # Exotel, not exercised here


RATES = Rates()

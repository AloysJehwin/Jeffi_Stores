"""The Anthropic client for the call LLM: workload identity federation first, an API key only as the fallback.

The client is built with explicit `credentials=`, which makes the SDK ignore ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
in the environment, so a stray variable can never shadow federation. The identity token is read from a file on every
exchange (a sidecar renews it). Nothing here logs a token, a key or the token file's contents.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .provider_config import VoiceConfig


def token_file_ok(path: str) -> bool:
    return bool(path) and os.path.isfile(path)


def build_llm_client(cfg: VoiceConfig) -> Any:
    """AsyncAnthropic for this call's config. Identity wins over a key; raises when neither is usable."""
    from anthropic import AsyncAnthropic

    ident = cfg.anthropic_identity
    if cfg.identity_ready():
        from anthropic.lib.credentials import IdentityTokenFile, WorkloadIdentityCredentials

        return AsyncAnthropic(
            credentials=WorkloadIdentityCredentials(
                identity_token_provider=IdentityTokenFile(cfg.anthropic_identity_token_file),
                federation_rule_id=ident.federation_rule_id,
                organization_id=ident.organization_id,
                service_account_id=ident.service_account_id,
                workspace_id=ident.workspace_id,
            )
        )
    if cfg.anthropic_api_key:
        return AsyncAnthropic(api_key=cfg.anthropic_api_key)
    raise RuntimeError("no Claude credentials: federation identity and token file, or an API key")

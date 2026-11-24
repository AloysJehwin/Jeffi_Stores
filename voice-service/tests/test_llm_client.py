from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from anthropic.lib.credentials import WorkloadIdentityCredentials

from voice_service.config import Settings, load_settings
from voice_service.llm_client import build_llm_client
from voice_service.provider_config import AnthropicIdentity, merge

IDENT = {
    "organizationId": "11111111-2222-3333-4444-555555555555",
    "workspaceId": "wrkspc_01",
    "serviceAccountId": "svac_01",
    "federationRuleId": "fdrl_01",
}


@pytest.fixture
def token_file(tmp_path: Path) -> str:
    p = tmp_path / "token"
    p.write_text("header.payload.SIGNATURE-SECRET")
    return str(p)


def cfg_for(settings: Settings, remote: dict[str, Any] | None = None, **kw: Any):
    return merge(remote, replace(settings, **kw))


def test_identity_wins_over_a_key(settings: Settings, token_file: str) -> None:
    cfg = cfg_for(settings, {"anthropicIdentity": IDENT}, anthropic_api_key="sk-ant-key", anthropic_identity_token_file=token_file)
    assert cfg.identity_ready()
    client = build_llm_client(cfg)
    assert isinstance(client.credentials, WorkloadIdentityCredentials)
    assert client.api_key is None and client.auth_token is None


def test_a_stray_env_auth_token_or_key_does_not_shadow_federation(
    settings: Settings, token_file: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "stray-token")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-stray")
    cfg = cfg_for(settings, {"anthropicIdentity": IDENT}, anthropic_api_key="", anthropic_identity_token_file=token_file)
    client = build_llm_client(cfg)
    assert isinstance(client.credentials, WorkloadIdentityCredentials)
    assert client.api_key is None and client.auth_token is None


def test_the_key_is_the_fallback_without_an_identity(settings: Settings) -> None:
    cfg = cfg_for(settings, None, anthropic_api_key="sk-ant-key")
    assert not cfg.identity_ready()
    client = build_llm_client(cfg)
    assert client.api_key == "sk-ant-key" and client.credentials is None


def test_identity_from_env_when_the_controller_has_none(settings: Settings, token_file: str) -> None:
    env = {
        "ANTHROPIC_ORGANIZATION_ID": IDENT["organizationId"],
        "ANTHROPIC_WORKSPACE_ID": IDENT["workspaceId"],
        "ANTHROPIC_SERVICE_ACCOUNT_ID": IDENT["serviceAccountId"],
        "ANTHROPIC_FEDERATION_RULE_ID": IDENT["federationRuleId"],
        "ANTHROPIC_IDENTITY_TOKEN_FILE": token_file,
    }
    cfg = merge(None, load_settings(env))
    assert cfg.anthropic_identity == AnthropicIdentity(
        IDENT["organizationId"], IDENT["workspaceId"], IDENT["serviceAccountId"], IDENT["federationRuleId"]
    )
    assert cfg.identity_ready()


def test_pod_env_overrides_the_controllers_identity_ids(settings: Settings, token_file: str) -> None:
    cfg = cfg_for(settings, {"anthropicIdentity": IDENT}, anthropic_federation_rule_id="fdrl_voice", anthropic_identity_token_file=token_file)
    assert cfg.anthropic_identity.federation_rule_id == "fdrl_voice"
    assert cfg.anthropic_identity.workspace_id == IDENT["workspaceId"]


def test_missing_names_what_is_absent(settings: Settings, token_file: str) -> None:
    bare = replace(settings, anthropic_api_key="")
    assert cfg_for(bare, None).claude_missing() == ["anthropic.identity-or-apiKey"]

    no_file = cfg_for(bare, {"anthropicIdentity": IDENT})
    assert no_file.claude_missing() == ["anthropic.identityTokenFile"]

    gone = cfg_for(bare, {"anthropicIdentity": IDENT}, anthropic_identity_token_file="/nonexistent/token")
    assert gone.claude_missing() == ["anthropic.identityTokenFile (file not found)"]

    partial = cfg_for(bare, {"anthropicIdentity": {**IDENT, "workspaceId": ""}}, anthropic_identity_token_file=token_file)
    assert partial.claude_missing() == ["anthropic.identity.workspaceId"]
    assert "anthropic.identity.workspaceId" in partial.missing()

    assert cfg_for(bare, {"anthropicIdentity": IDENT}, anthropic_identity_token_file=token_file).claude_missing() == []
    assert cfg_for(settings, None).claude_missing() == []  # key present


def test_no_credentials_refuses_to_build(settings: Settings) -> None:
    with pytest.raises(RuntimeError):
        build_llm_client(cfg_for(replace(settings, anthropic_api_key=""), None))


def test_the_token_is_never_in_the_config_repr_or_error(settings: Settings, token_file: str) -> None:
    cfg = cfg_for(settings, {"anthropicIdentity": IDENT}, anthropic_identity_token_file=token_file)
    assert "SIGNATURE-SECRET" not in repr(cfg)

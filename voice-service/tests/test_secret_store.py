"""Boot secrets: Secrets Manager (boto3 mocked) or Key Vault over REST (httpx MockTransport), env first."""

from __future__ import annotations

import json
import sys
import types
from typing import Any

import httpx
import pytest

from voice_service import config
from voice_service.secret_store import SecretError, key_vault_name, load_secret_env, secrets_backend

VAULT = "https://jeffi-test-kv.vault.azure.net"
NO_SLEEP = lambda _s: None  # noqa: E731


class FakeVault:
    def __init__(self, secrets: dict[str, str] | None = None):
        self.secrets = dict(secrets or {})
        self.calls: list[httpx.Request] = []
        self.fail_first: list[httpx.Response | Exception] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        if self.fail_first:
            r = self.fail_first.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        if req.url.host == "169.254.169.254":
            return httpx.Response(200, json={"access_token": "mi-token", "expires_in": "3600"})
        if req.url.path.endswith("/oauth2/v2.0/token"):
            return httpx.Response(200, json={"access_token": "wi-token", "expires_in": 3600})
        name = req.url.path.removeprefix("/secrets/")
        if name in self.secrets:
            return httpx.Response(200, json={"value": self.secrets[name]})
        return httpx.Response(404, json={"error": {"code": "SecretNotFound", "message": f"A secret with (name/id) {name} was not found."}})

    def vault_calls(self) -> list[str]:
        return [f"{r.method} {r.url.path}" for r in self.calls if str(r.url).startswith(VAULT)]


def kv_env(**extra: str) -> dict[str, str]:
    return {"SECRETS_BACKEND": "keyvault", "AZURE_KEY_VAULT_URL": VAULT, **extra}


def test_backend_and_names_match_the_node_library() -> None:
    assert secrets_backend({}) == "aws"
    assert secrets_backend({"SECRETS_BACKEND": "Key-Vault"}) == "keyvault"
    with pytest.raises(ValueError):
        secrets_backend({"SECRETS_BACKEND": "gcp"})
    assert key_vault_name("jeffi/voice/production") == "jeffi-voice-production"
    assert key_vault_name("jeffi/a_b.c") == "jeffi-a-b-c"
    assert key_vault_name("arn:aws:secretsmanager:us-east-1:123456789012:secret:jeffi/voice-AbC123") == "jeffi-voice"
    with pytest.raises(ValueError):
        key_vault_name("")


def test_key_vault_with_the_vm_identity() -> None:
    fake = FakeVault({"jeffi-voice-production": json.dumps({"SARVAM_API_KEY": "s", "N": 3})})
    got = load_secret_env("jeffi/voice/production", env=kv_env(AZURE_MI_CLIENT_ID="uami-1"), transport=httpx.MockTransport(fake), sleep=NO_SLEEP)
    assert got == {"SARVAM_API_KEY": "s"}
    imds = fake.calls[0]
    assert imds.headers["Metadata"] == "true"
    assert imds.url.params["resource"] == "https://vault.azure.net"
    assert imds.url.params["client_id"] == "uami-1"
    vault = fake.calls[1]
    assert vault.url.params["api-version"] == "7.4"
    assert vault.headers["Authorization"] == "Bearer mi-token"


def test_key_vault_with_workload_identity(tmp_path: Any) -> None:
    tok = tmp_path / "token"
    tok.write_text("cluster.jwt.sig\n")
    fake = FakeVault({"jeffi-voice-production": '{"A":"a"}'})
    env = kv_env(AZURE_FEDERATED_TOKEN_FILE=str(tok), AZURE_CLIENT_ID="app-1", AZURE_TENANT_ID="tenant-1", AZURE_AUTHORITY_HOST="https://login.example.test")
    assert load_secret_env("jeffi/voice/production", env=env, transport=httpx.MockTransport(fake), sleep=NO_SLEEP) == {"A": "a"}
    post = fake.calls[0]
    assert str(post.url) == "https://login.example.test/tenant-1/oauth2/v2.0/token"
    form = dict(x.split("=", 1) for x in post.content.decode().split("&"))
    assert form["client_id"] == "app-1"
    assert form["client_assertion"] == "cluster.jwt.sig"
    assert form["grant_type"] == "client_credentials"
    assert not any(r.url.host == "169.254.169.254" for r in fake.calls)
    assert fake.calls[1].headers["Authorization"] == "Bearer wi-token"


def test_key_vault_retries_hiccups_and_falls_back_when_missing() -> None:
    fake = FakeVault({"jeffi-production": '{"A":"fb"}'})
    fake.fail_first = [httpx.ConnectError("refused"), httpx.Response(503)]
    got = load_secret_env("jeffi/voice/production", env=kv_env(), fallback_id="jeffi/production", transport=httpx.MockTransport(fake), sleep=NO_SLEEP)
    assert got == {"A": "fb"}
    assert fake.vault_calls() == ["GET /secrets/jeffi-voice-production", "GET /secrets/jeffi-production"]


def test_key_vault_errors() -> None:
    fake = FakeVault()
    with pytest.raises(SecretError) as e:
        load_secret_env("jeffi/nope", env=kv_env(), transport=httpx.MockTransport(fake), sleep=NO_SLEEP)
    assert e.value.code == "NotFound"
    fake = FakeVault({"jeffi-x": "not json", "jeffi-e": ""})
    for sid, code in (("jeffi/x", "Invalid"), ("jeffi/e", "Empty")):
        with pytest.raises(SecretError) as e:
            load_secret_env(sid, env=kv_env(), transport=httpx.MockTransport(fake), sleep=NO_SLEEP)
        assert e.value.code == code
    denied = lambda req: httpx.Response(400, json={"error": "invalid_request", "error_description": "Identity not found"})  # noqa: E731
    with pytest.raises(RuntimeError, match="Azure managed identity token failed: Identity not found"):
        load_secret_env("jeffi/x", env=kv_env(), transport=httpx.MockTransport(denied), sleep=NO_SLEEP)


class FakeClientError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.response = {"Error": {"Code": code, "Message": code}}


@pytest.fixture
def boto(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    state: dict[str, Any] = {"secrets": {}, "calls": [], "regions": []}

    class Client:
        def get_secret_value(self, SecretId: str) -> dict[str, str]:  # noqa: N803
            state["calls"].append(SecretId)
            if SecretId not in state["secrets"]:
                raise FakeClientError("ResourceNotFoundException")
            return {"SecretString": state["secrets"][SecretId]}

    def client(service: str, region_name: str | None = None) -> Client:
        assert service == "secretsmanager"
        state["regions"].append(region_name)
        return Client()

    monkeypatch.setitem(sys.modules, "boto3", types.SimpleNamespace(client=client))
    monkeypatch.setitem(sys.modules, "botocore", types.ModuleType("botocore"))
    monkeypatch.setitem(sys.modules, "botocore.exceptions", types.SimpleNamespace(ClientError=FakeClientError))
    return state


def test_secrets_manager_by_default_with_fallback(boto: dict[str, Any]) -> None:
    boto["secrets"]["jeffi/production"] = '{"A":"sm"}'
    assert load_secret_env("jeffi/voice/production", "ap-south-1", env={}, fallback_id="jeffi/production") == {"A": "sm"}
    assert boto["calls"] == ["jeffi/voice/production", "jeffi/production"]
    assert boto["regions"] == ["ap-south-1", "ap-south-1"]
    with pytest.raises(SecretError) as e:
        load_secret_env("jeffi/nope", env={})
    assert e.value.code == "NotFound"


def test_bootstrap_env_fills_only_missing_keys(boto: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    boto["secrets"]["jeffi/voice/production"] = '{"A":"from-secret","B":"from-secret"}'
    monkeypatch.setenv("SM_SECRET_ID", "jeffi/voice/production")
    monkeypatch.delenv("SECRETS_BACKEND", raising=False)
    monkeypatch.setenv("B", "explicit")
    monkeypatch.delenv("A", raising=False)
    config.bootstrap_env()
    import os

    assert os.environ["A"] == "from-secret"
    assert os.environ["B"] == "explicit"


def test_bootstrap_env_reads_nothing_without_an_id_or_with_env(boto: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SM_SECRET_ID", raising=False)
    config.bootstrap_env()
    monkeypatch.setenv("SM_SECRET_ID", "jeffi/voice/production")
    monkeypatch.setenv("SECRETS_BACKEND", "env")
    config.bootstrap_env()
    assert boto["calls"] == []

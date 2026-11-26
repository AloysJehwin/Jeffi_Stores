"""Boot secrets, as the Node services read them (packages/store-core/src/lib/secrets/index.mjs).

SECRETS_BACKEND picks the store: `aws` (default, Secrets Manager through the default credential chain) or
`keyvault` (Azure Key Vault over REST, AZURE_KEY_VAULT_URL or _NAME). Ids are Secrets Manager names; Key Vault keeps
them as key_vault_name() (`jeffi/voice/production` -> `jeffi-voice-production`). Key Vault tokens come from workload
identity (AZURE_FEDERATED_TOKEN_FILE + AZURE_CLIENT_ID + AZURE_TENANT_ID) when set, else the VM's managed identity
(IMDS; AZURE_MI_CLIENT_ID, else AZURE_CLIENT_ID, picks a user-assigned one). Values are never logged.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Mapping
from pathlib import Path

import httpx

KV_API = "7.4"
KV_RESOURCE = "https://vault.azure.net"
_ARN = re.compile(r"^arn:aws[\w-]*:secretsmanager:[^:]*:\d*:secret:(.+)$")


class SecretError(Exception):
    """code: NotFound, Denied, Empty, Invalid or Backend."""

    def __init__(self, code: str, secret: str, message: str):
        super().__init__(message)
        self.code = code
        self.secret = secret


def secrets_backend(env: Mapping[str, str]) -> str:
    v = (env.get("SECRETS_BACKEND") or "aws").strip().lower()
    if v in ("aws", "secretsmanager"):
        return "aws"
    if v in ("keyvault", "key-vault", "azure"):
        return "keyvault"
    raise ValueError(f'SECRETS_BACKEND must be aws or keyvault (got "{env.get("SECRETS_BACKEND")}")')


def key_vault_name(name: str) -> str:
    """`jeffi/voice/production` (or its ARN) as a Key Vault name: letters, digits and dashes, 1-127 chars."""
    n = str(name or "")
    m = _ARN.match(n)
    if m:
        n = re.sub(r"-[A-Za-z0-9]{6}$", "", m.group(1))
    n = re.sub(r"[^0-9A-Za-z-]", "-", n)
    if not n or len(n) > 127:
        raise ValueError(f'"{name}" cannot be a Key Vault secret name')
    return n


def key_vault_url(env: Mapping[str, str]) -> str:
    url = env.get("AZURE_KEY_VAULT_URL") or (
        f"https://{env['AZURE_KEY_VAULT_NAME']}.vault.azure.net" if env.get("AZURE_KEY_VAULT_NAME") else ""
    )
    if not url:
        raise ValueError("Key Vault not configured: set AZURE_KEY_VAULT_URL or AZURE_KEY_VAULT_NAME")
    return url.rstrip("/")


def _send(client: httpx.Client, method: str, url: str, sleep: Callable[[float], None], **kw) -> httpx.Response:
    """Up to 3 tries on a failed connection, 429 or 5xx (IMDS, Entra and Key Vault have brief hiccups)."""
    for i in range(3):
        try:
            res = client.request(method, url, **kw)
        except httpx.TransportError:
            if i == 2:
                raise
        else:
            if i == 2 or not (res.status_code == 429 or res.status_code >= 500):
                return res
        sleep(0.5 * (i + 1))
    raise AssertionError("unreachable")


def _azure_token(env: Mapping[str, str], client: httpx.Client, sleep: Callable[[float], None]) -> str:
    federated = env.get("AZURE_FEDERATED_TOKEN_FILE") and env.get("AZURE_CLIENT_ID") and env.get("AZURE_TENANT_ID")
    if federated:
        authority = (env.get("AZURE_AUTHORITY_HOST") or "https://login.microsoftonline.com/").rstrip("/") + "/"
        res = _send(
            client,
            "POST",
            f"{authority}{env['AZURE_TENANT_ID']}/oauth2/v2.0/token",
            sleep,
            data={
                "client_id": env["AZURE_CLIENT_ID"],
                "scope": f"{KV_RESOURCE}/.default",
                "grant_type": "client_credentials",
                "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                "client_assertion": Path(env["AZURE_FEDERATED_TOKEN_FILE"]).read_text().strip(),
            },
            timeout=10,
        )
    else:
        params = {"api-version": "2018-02-01", "resource": KV_RESOURCE}
        mi = env.get("AZURE_MI_CLIENT_ID") or env.get("AZURE_CLIENT_ID")
        if mi:
            params["client_id"] = mi
        base = env.get("AZURE_IMDS_ENDPOINT") or "http://169.254.169.254"
        res = _send(client, "GET", f"{base}/metadata/identity/oauth2/token", sleep, params=params, headers={"Metadata": "true"}, timeout=5)
    try:
        body = res.json()
    except ValueError:
        body = {}
    token = body.get("access_token") if isinstance(body, dict) else None
    if res.status_code != 200 or not token:
        why = (body.get("error_description") or body.get("error")) if isinstance(body, dict) else None
        kind = "workload identity" if federated else "managed identity"
        raise RuntimeError(f"Azure {kind} token failed: {why or f'HTTP {res.status_code}'}")
    return token


def _key_vault_get(secret_id: str, env: Mapping[str, str], client: httpx.Client, sleep: Callable[[float], None]) -> str:
    name = key_vault_name(secret_id)
    url = f"{key_vault_url(env)}/secrets/{name}"
    token = _azure_token(env, client, sleep)
    res = _send(client, "GET", url, sleep, params={"api-version": KV_API}, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    if res.status_code == 401:
        token = _azure_token(env, client, sleep)
        res = _send(client, "GET", url, sleep, params={"api-version": KV_API}, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    if res.status_code == 200:
        return res.json().get("value") or ""
    try:
        detail = res.json().get("error", {}).get("message") or res.text
    except ValueError:
        detail = res.text
    code = "NotFound" if res.status_code == 404 else "Denied" if res.status_code in (401, 403) else "Backend"
    raise SecretError(code, secret_id, f"Key Vault {res.status_code}: {detail}")


def _aws_get(secret_id: str, region: str | None) -> str:
    import boto3
    from botocore.exceptions import ClientError

    try:
        res = boto3.client("secretsmanager", region_name=region).get_secret_value(SecretId=secret_id)
    except ClientError as e:
        name = e.response.get("Error", {}).get("Code", "")
        code = "NotFound" if name == "ResourceNotFoundException" else "Denied" if name == "AccessDeniedException" else "Backend"
        raise SecretError(code, secret_id, f"{name}: {e}") from e
    return res.get("SecretString") or ""


def read_secret(
    secret_id: str,
    region: str | None = None,
    *,
    env: Mapping[str, str],
    transport: httpx.BaseTransport | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    if secrets_backend(env) == "keyvault":
        with httpx.Client(transport=transport) as client:
            return _key_vault_get(secret_id, env, client, sleep)
    return _aws_get(secret_id, region)


def load_secret_env(
    secret_id: str,
    region: str | None = None,
    *,
    env: Mapping[str, str],
    fallback_id: str | None = None,
    transport: httpx.BaseTransport | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, str]:
    """The JSON blob's string values; `fallback_id` is read when `secret_id` is missing or denied."""
    used = secret_id
    try:
        raw = read_secret(secret_id, region, env=env, transport=transport, sleep=sleep)
    except SecretError as e:
        if not fallback_id or e.code not in ("NotFound", "Denied"):
            raise
        used = fallback_id
        raw = read_secret(fallback_id, region, env=env, transport=transport, sleep=sleep)
    if not raw:
        raise SecretError("Empty", used, f'Secret "{used}" is empty')
    try:
        parsed = json.loads(raw)
    except ValueError:
        raise SecretError("Invalid", used, f'Secret "{used}" is not valid JSON') from None
    if not isinstance(parsed, dict):
        raise SecretError("Invalid", used, f'Secret "{used}" is not a JSON object')
    return {k: v for k, v in parsed.items() if isinstance(v, str)}

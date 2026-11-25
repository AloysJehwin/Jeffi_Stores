// The boot loader's secret store: Secrets Manager (default) or Azure Key Vault (SECRETS_BACKEND=keyvault).
// Dependency-free on the Key Vault side (plain fetch), so every image that already copies deploy/load-secrets.mjs
// only needs this file next to it. Thin shim for the plan's cloud-neutral secrets interface (Phase C,
// docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md): keep readSecret/keyVaultName in step with that library's
// equivalents if it lands with other names.
//
// Key Vault names allow only letters, digits and dashes: jeffi/production -> jeffi-production (kvSecretName).
// Token, first match wins:
//   AZURE_FEDERATED_TOKEN_FILE + AZURE_CLIENT_ID + AZURE_TENANT_ID   workload identity (a projected k3s token
//       exchanged at Entra; works on any node, AWS ones included; deploy/k8s/overlays/azure sets it)
//   otherwise                                                         the VM's managed identity through IMDS
//       (AZURE_MI_CLIENT_ID picks a user-assigned one)
// Vault: AZURE_KEY_VAULT_URL or AZURE_KEY_VAULT_NAME.
// Errors carry name ResourceNotFoundException / AccessDeniedException like the AWS SDK's, so callers' fallbacks
// treat both backends alike.

const KV_SCOPE = 'https://vault.azure.net'
const TIMEOUT_MS = 10_000

export const keyVaultName = id => id.replace(/[^A-Za-z0-9-]/g, '-')

export function secretsBackend(env = process.env) {
  return env.SECRETS_BACKEND === 'keyvault' ? 'keyvault' : 'aws'
}

function fail(name, message) {
  const err = new Error(message)
  err.name = name
  return err
}

// Network errors, 429 and 5xx are retried (IMDS and Entra have brief hiccups); other statuses fail at once.
async function fetchJson(url, init, what) {
  let last
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, (attempt - 1) * 1000))
    let res
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      last = fail('NetworkError', `${what}: ${err.message}`)
      continue
    }
    const body = await res.json().catch(() => ({}))
    if (res.ok) return body
    const detail = body?.error?.message || body?.error_description || body?.error || res.statusText
    if (res.status === 404) throw fail('ResourceNotFoundException', `${what}: not found`)
    if (res.status === 401 || res.status === 403) throw fail('AccessDeniedException', `${what}: ${res.status} ${detail}`)
    last = fail('ServiceError', `${what}: ${res.status} ${detail}`)
    if (res.status < 500 && res.status !== 429) throw last
  }
  throw last
}

async function azureToken(env) {
  const { AZURE_FEDERATED_TOKEN_FILE: file, AZURE_CLIENT_ID: clientId, AZURE_TENANT_ID: tenant } = env
  if (file && clientId && tenant) {
    const { readFileSync } = await import('fs')
    const form = new URLSearchParams({
      client_id: clientId,
      scope: `${KV_SCOPE}/.default`,
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: readFileSync(file, 'utf8').trim(),
    })
    const authority = (env.AZURE_AUTHORITY_HOST || 'https://login.microsoftonline.com').replace(/\/$/, '')
    const body = await fetchJson(`${authority}/${tenant}/oauth2/v2.0/token`, { method: 'POST', body: form }, 'Entra token (workload identity)')
    return body.access_token
  }
  const q = new URLSearchParams({ 'api-version': '2018-02-01', resource: KV_SCOPE })
  if (env.AZURE_MI_CLIENT_ID) q.set('client_id', env.AZURE_MI_CLIENT_ID)
  const body = await fetchJson(`http://169.254.169.254/metadata/identity/oauth2/token?${q}`, { headers: { Metadata: 'true' } }, 'Entra token (managed identity)')
  return body.access_token
}

function vaultUrl(env) {
  if (env.AZURE_KEY_VAULT_URL) return env.AZURE_KEY_VAULT_URL.replace(/\/$/, '')
  if (env.AZURE_KEY_VAULT_NAME) return `https://${env.AZURE_KEY_VAULT_NAME}.vault.azure.net`
  throw fail('ConfigError', 'SECRETS_BACKEND=keyvault needs AZURE_KEY_VAULT_NAME or AZURE_KEY_VAULT_URL')
}

// The secret's string value (Secrets Manager SecretString, or the Key Vault secret's value), or undefined if empty.
export async function readSecret(id, { env = process.env, region } = {}) {
  if (secretsBackend(env) === 'keyvault') {
    const name = keyVaultName(id)
    const token = await azureToken(env)
    const body = await fetchJson(`${vaultUrl(env)}/secrets/${encodeURIComponent(name)}?api-version=7.4`, { headers: { Authorization: `Bearer ${token}` } }, `Key Vault secret "${name}"`)
    return body.value || undefined
  }
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
  const client = new SecretsManagerClient({ region: region || env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1' })
  const res = await client.send(new GetSecretValueCommand({ SecretId: id }))
  return res.SecretString || undefined
}

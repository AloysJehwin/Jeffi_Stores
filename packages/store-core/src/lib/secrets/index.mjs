// One secrets interface for app code and deploy/load-secrets.mjs. SECRETS_BACKEND picks the store:
// `aws` (default, Secrets Manager) or `keyvault` (Azure Key Vault, AZURE_KEY_VAULT_URL or _NAME).
// Callers always use Secrets Manager names (`jeffi/tenant-db/acme`); Key Vault keeps them as
// keyVaultName() (`jeffi-tenant-db-acme`). Values are strings, JSON blobs stay JSON.
// Plain ESM with no dependencies (Key Vault over fetch, the AWS SDK loaded on demand): deploy/load-secrets.mjs
// imports this file directly, and both Dockerfiles copy it next to the loader. Types: index.d.mts.

const KV_API = '7.4'
const KV_RESOURCE = 'https://vault.azure.net'
const DELETED_RE = /marked for deletion|scheduled for deletion/i

export class SecretError extends Error {
  constructor(code, secret, message, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SecretError'
    this.code = code
    this.secret = secret
  }
}

export const isSecretError = (e, code) => e?.name === 'SecretError' && (code === undefined || e.code === code)

export function secretsBackend(env = process.env) {
  const v = (env.SECRETS_BACKEND || 'aws').trim().toLowerCase()
  if (v === 'aws' || v === 'secretsmanager') return 'aws'
  if (v === 'keyvault' || v === 'key-vault' || v === 'azure') return 'keyvault'
  throw new Error(`SECRETS_BACKEND must be aws or keyvault (got "${env.SECRETS_BACKEND}")`)
}

/** `jeffi/tenant-db/acme` (or its ARN) as a Key Vault name: letters, digits and dashes, 1-127 chars. */
export function keyVaultName(name) {
  let n = String(name ?? '')
  const arn = /^arn:aws[\w-]*:secretsmanager:[^:]*:\d*:secret:(.+)$/.exec(n)
  if (arn) n = arn[1].replace(/-[A-Za-z0-9]{6}$/, '')
  n = n.replace(/[^0-9A-Za-z-]/g, '-')
  if (!n || n.length > 127) throw new Error(`"${name}" cannot be a Key Vault secret name`)
  return n
}

export function keyVaultUrl(env = process.env) {
  const url = env.AZURE_KEY_VAULT_URL || (env.AZURE_KEY_VAULT_NAME ? `https://${env.AZURE_KEY_VAULT_NAME}.vault.azure.net` : '')
  if (!url) throw new Error('Key Vault not configured: set AZURE_KEY_VAULT_URL or AZURE_KEY_VAULT_NAME')
  return url.replace(/\/+$/, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A request that failed before any response (connection refused, reset, timeout) is tried up to 3 times:
// IMDS, Entra and Key Vault have brief hiccups, and the boot loader must not fail a pod on one.
async function fetchRetry(fetchImpl, url, init) {
  for (let i = 0; ; i++) {
    try {
      return await fetchImpl(url, init())
    } catch (e) {
      if (i >= 2) throw e
      await sleep(500 * (i + 1))
    }
  }
}

// ---- AWS Secrets Manager ------------------------------------------------------------------------

function awsError(e, name) {
  const msg = `${e?.name || 'Error'}: ${e?.message || e}`
  if (e?.name === 'ResourceNotFoundException') return new SecretError('NotFound', name, msg, e)
  if (e?.name === 'ResourceExistsException') return new SecretError('Exists', name, msg, e)
  if (e?.name === 'AccessDeniedException') return new SecretError('Denied', name, msg, e)
  if (e?.name === 'InvalidRequestException' && DELETED_RE.test(e?.message || '')) return new SecretError('Deleted', name, msg, e)
  return new SecretError('Backend', name, msg, e)
}

function awsClient({ region, env }) {
  let sdk
  const load = async () => {
    if (!sdk) {
      const m = await import('@aws-sdk/client-secrets-manager')
      sdk = { m, c: new m.SecretsManagerClient({ region: region || env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1' }) }
    }
    return sdk
  }
  const send = async (name, cmd, input) => {
    const { m, c } = await load()
    try {
      return await c.send(new m[cmd](input))
    } catch (e) {
      throw awsError(e, name)
    }
  }
  const client = {
    backend: 'aws',
    async get(name) {
      const r = await send(name, 'GetSecretValueCommand', { SecretId: name })
      if (r.SecretString !== undefined) return r.SecretString
      if (r.SecretBinary) return Buffer.from(r.SecretBinary).toString('utf8')
      return ''
    },
    async put(name, value) {
      try {
        await send(name, 'PutSecretValueCommand', { SecretId: name, SecretString: value })
      } catch (e) {
        if (!isSecretError(e, 'NotFound')) throw e
        await send(name, 'CreateSecretCommand', { Name: name, SecretString: value })
      }
    },
    async create(name, value) {
      await send(name, 'CreateSecretCommand', { Name: name, SecretString: value })
      return value
    },
    async remove(name, { force = false, recoveryDays = 7 } = {}) {
      const del = () =>
        send(name, 'DeleteSecretCommand', force ? { SecretId: name, ForceDeleteWithoutRecovery: true } : { SecretId: name, RecoveryWindowInDays: recoveryDays })
      try {
        await del()
      } catch (e) {
        if (isSecretError(e, 'NotFound')) return
        if (!isSecretError(e, 'Deleted')) throw e
        if (!force) return
        // Force-deleting one already scheduled: restore it, then delete with no recovery.
        await send(name, 'RestoreSecretCommand', { SecretId: name })
        await del()
      }
    },
    async restore(name) {
      await send(name, 'RestoreSecretCommand', { SecretId: name })
    },
  }
  return client
}

// ---- Azure Key Vault ----------------------------------------------------------------------------

const tokens = new Map()

/**
 * A Key Vault access token: workload identity (AZURE_FEDERATED_TOKEN_FILE + AZURE_CLIENT_ID +
 * AZURE_TENANT_ID, the cluster's OIDC issuer federated in Entra) when configured, else the VM's
 * managed identity from IMDS (AZURE_MI_CLIENT_ID, else AZURE_CLIENT_ID, picks a user-assigned one).
 */
async function azureToken(env, fetchImpl, refresh = false) {
  const federated = env.AZURE_FEDERATED_TOKEN_FILE && env.AZURE_CLIENT_ID && env.AZURE_TENANT_ID
  const key = federated ? `wi:${env.AZURE_TENANT_ID}:${env.AZURE_CLIENT_ID}` : `mi:${env.AZURE_CLIENT_ID || ''}`
  const hit = tokens.get(key)
  if (!refresh && hit && hit.exp > Date.now()) return hit.token
  let res
  if (federated) {
    const { readFile } = await import('node:fs/promises')
    const assertion = (await readFile(env.AZURE_FEDERATED_TOKEN_FILE, 'utf8')).trim()
    const authority = (env.AZURE_AUTHORITY_HOST || 'https://login.microsoftonline.com/').replace(/\/?$/, '/')
    const body = new URLSearchParams({
      client_id: env.AZURE_CLIENT_ID,
      scope: `${KV_RESOURCE}/.default`,
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }).toString()
    res = await fetchRetry(fetchImpl, `${authority}${env.AZURE_TENANT_ID}/oauth2/v2.0/token`, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    }))
  } else {
    const q = new URLSearchParams({ 'api-version': '2018-02-01', resource: KV_RESOURCE })
    const mi = env.AZURE_MI_CLIENT_ID || env.AZURE_CLIENT_ID
    if (mi) q.set('client_id', mi)
    const url = `${env.AZURE_IMDS_ENDPOINT || 'http://169.254.169.254'}/metadata/identity/oauth2/token?${q}`
    for (let i = 0; ; i++) {
      res = await fetchRetry(fetchImpl, url, () => ({ headers: { Metadata: 'true' }, signal: AbortSignal.timeout(5_000) }))
      if (i >= 2 || !(res.status === 429 || res.status >= 500)) break
      await sleep(500 * (i + 1))
    }
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    const why = body.error_description || body.error || `HTTP ${res.status}`
    throw new Error(`Azure ${federated ? 'workload identity' : 'managed identity'} token failed: ${why}`)
  }
  const ttl = Number(body.expires_in) || (Number(body.expires_on) ? Number(body.expires_on) - Date.now() / 1000 : 3600)
  tokens.set(key, { token: body.access_token, exp: Date.now() + Math.max(60, ttl - 300) * 1000 })
  return body.access_token
}

function keyVaultClient({ env, fetch: fetchImpl = globalThis.fetch, settleMs = 1000, pollMs = 1000 }) {
  const base = keyVaultUrl(env)

  async function call(method, path, body) {
    let token = await azureToken(env, fetchImpl)
    for (let i = 0; ; i++) {
      const res = await fetchRetry(fetchImpl, `${base}${path}${path.includes('?') ? '&' : '?'}api-version=${KV_API}`, () => ({
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      }))
      if (res.status === 401 && i === 0) {
        token = await azureToken(env, fetchImpl, true)
        continue
      }
      if ((res.status === 429 || res.status >= 500) && i < 2) {
        await sleep(Math.min(5_000, (Number(res.headers.get('retry-after')) || 1) * 1000))
        continue
      }
      const text = await res.text()
      let json = {}
      try {
        json = text ? JSON.parse(text) : {}
      } catch {}
      return { status: res.status, json, message: json?.error?.message || text || `HTTP ${res.status}` }
    }
  }
  const fail = (code, name, r) => new SecretError(code, name, `Key Vault ${r.status}: ${r.message}`)
  const backendError = (name, r) => fail(r.status === 401 || r.status === 403 ? 'Denied' : 'Backend', name, r)
  const isDeletedConflict = (r) => r.status === 409 && /deleted/i.test(r.message)

  async function isSoftDeleted(kv) {
    const r = await call('GET', `/deletedsecrets/${kv}`)
    return r.status === 200
  }

  async function get(name) {
    const kv = keyVaultName(name)
    const r = await call('GET', `/secrets/${kv}`)
    if (r.status === 200) return r.json.value ?? ''
    if (r.status === 404) throw fail((await isSoftDeleted(kv)) ? 'Deleted' : 'NotFound', name, r)
    throw backendError(name, r)
  }

  async function put(name, value) {
    const r = await call('PUT', `/secrets/${keyVaultName(name)}`, { value })
    if (r.status === 200) return
    throw isDeletedConflict(r) ? fail('Deleted', name, r) : backendError(name, r)
  }

  async function purge(name, kv) {
    for (let i = 0; i < 15; i++) {
      const r = await call('DELETE', `/deletedsecrets/${kv}`)
      if (r.status === 204 || r.status === 200 || r.status === 404) return
      // The delete is still in progress.
      if (r.status !== 409) throw backendError(name, r)
      await sleep(pollMs)
    }
    throw new SecretError('Backend', name, `Key Vault: ${name} was not purged in time`)
  }

  return {
    backend: 'keyvault',
    get,
    put,
    // Key Vault has no create-if-absent: write, let a racing writer land, then the last write wins for all.
    async create(name, value) {
      try {
        await get(name)
        throw new SecretError('Exists', name, `Key Vault: ${name} already exists`)
      } catch (e) {
        if (!isSecretError(e, 'NotFound')) throw e
      }
      await put(name, value)
      if (settleMs) await sleep(settleMs)
      if ((await get(name)) !== value) throw new SecretError('Exists', name, `Key Vault: ${name} was created concurrently`)
      return value
    },
    async remove(name, { force = false } = {}) {
      const kv = keyVaultName(name)
      const r = await call('DELETE', `/secrets/${kv}`)
      if (r.status !== 200 && r.status !== 404) throw backendError(name, r)
      if (force) await purge(name, kv)
    },
    async restore(name) {
      const kv = keyVaultName(name)
      const r = await call('POST', `/deletedsecrets/${kv}/recover`)
      if (r.status === 404) throw fail('NotFound', name, r)
      if (r.status !== 200) throw backendError(name, r)
      // Recovery is asynchronous: wait until the secret reads again.
      for (let i = 0; i < 15; i++) {
        const g = await call('GET', `/secrets/${kv}`)
        if (g.status === 200) return
        if (g.status !== 404) throw backendError(name, g)
        await sleep(pollMs)
      }
      throw new SecretError('Backend', name, `Key Vault: ${name} was not recovered in time`)
    },
  }
}

// ---- Entry points -------------------------------------------------------------------------------

/** A client for the configured (or given) backend. `region` applies to Secrets Manager only. */
export function createSecretsClient(opts = {}) {
  const env = opts.env || process.env
  const backend = opts.backend ? secretsBackend({ SECRETS_BACKEND: opts.backend }) : secretsBackend(env)
  return backend === 'keyvault' ? keyVaultClient({ ...opts, env }) : awsClient({ region: opts.region, env })
}

const clients = new Map()
/** The process-wide client for SECRETS_BACKEND (cached per backend and region). */
export function secrets(region) {
  const key = `${secretsBackend()}|${region || ''}`
  let c = clients.get(key)
  if (!c) clients.set(key, (c = createSecretsClient({ region })))
  return c
}

export async function getSecretJson(name, opts) {
  const client = opts ? createSecretsClient(opts) : secrets()
  const raw = await client.get(name)
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new SecretError('Invalid', name, `${name} is not valid JSON`)
  }
}

// A database login secret ({username,password,database}), cached 5 minutes per name.
const dbSecrets = new Map()
const DB_SECRET_TTL_MS = 5 * 60 * 1000

export async function fetchDbSecret(ref, region) {
  const now = Date.now()
  const key = `${secretsBackend()}|${ref}`
  const hit = dbSecrets.get(key)
  if (hit && hit.expiresAt > now) return hit
  const parsed = JSON.parse((await secrets(region).get(ref)) || '{}')
  if (!parsed.password) throw new Error(`Secret ${ref} has no password field`)
  const entry = { username: parsed.username, password: parsed.password, database: parsed.database, expiresAt: now + DB_SECRET_TTL_MS }
  dbSecrets.set(key, entry)
  return entry
}

export function forgetDbSecret(ref) {
  for (const k of [...dbSecrets.keys()]) if (k.endsWith(`|${ref}`)) dbSecrets.delete(k)
}

// The fallback reads for errors the boot loader always fell back on: missing or denied, also when only the
// Secrets Manager SDK's own error says so.
const FALLBACK_RE = /ResourceNotFound|AccessDenied/
const fallsBack = (e) => isSecretError(e, 'NotFound') || isSecretError(e, 'Denied') || FALLBACK_RE.test(`${e?.cause?.name} ${e?.cause?.message}`)

/**
 * For the boot loader: read the JSON blob `id` (e.g. `jeffi/production`) and return its string values.
 * `fallbackId` is read instead when `id` is missing or not readable yet (`onFallback` hears why first).
 * Throws SecretError: Empty for an empty secret, Invalid when it is not a JSON object.
 */
export async function loadSecretEnv(id, opts = {}) {
  const { fallbackId, onFallback, ...rest } = opts
  const client = createSecretsClient(rest)
  let used = id
  let raw
  try {
    raw = await client.get(id)
  } catch (e) {
    if (!fallbackId || !fallsBack(e)) throw e
    onFallback?.(e)
    used = fallbackId
    raw = await client.get(fallbackId)
  }
  if (!raw) throw new SecretError('Empty', used, `Secret "${used}" is empty`)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SecretError('Invalid', used, `Secret "${used}" is not valid JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SecretError('Invalid', used, `Secret "${used}" is not a JSON object`)
  const values = {}
  for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') values[k] = v
  return { id: used, backend: client.backend, values, size: Object.keys(parsed).length }
}

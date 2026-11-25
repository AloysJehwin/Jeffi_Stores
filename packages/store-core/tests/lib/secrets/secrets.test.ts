// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sm = vi.hoisted(() => ({ send: vi.fn(), regions: [] as (string | undefined)[] }))
vi.mock('@aws-sdk/client-secrets-manager', () => {
  const cmd = (name: string) =>
    class {
      readonly cmd = name
      constructor(public input: any) {}
    }
  return {
    SecretsManagerClient: class {
      send = sm.send
      constructor(o: any) {
        sm.regions.push(o?.region)
      }
    },
    GetSecretValueCommand: cmd('Get'),
    PutSecretValueCommand: cmd('Put'),
    CreateSecretCommand: cmd('Create'),
    DeleteSecretCommand: cmd('Delete'),
    RestoreSecretCommand: cmd('Restore'),
  }
})

type Mod = typeof import('@/lib/secrets/index.mjs')
async function load(): Promise<Mod> {
  vi.resetModules()
  return import('@/lib/secrets/index.mjs')
}

const awsErr = (name: string, message = name) => Object.assign(new Error(message), { name })
const sent = () => sm.send.mock.calls.map(([c]) => ({ cmd: c.cmd, ...c.input }))

const ENV = { ...process.env }
beforeEach(() => {
  sm.send.mockReset()
  sm.regions.length = 0
})
afterEach(() => {
  process.env = { ...ENV }
})

// ---- a fake Key Vault (+ IMDS and Entra token endpoints) over fetch ------------------------------
const VAULT = 'https://jeffi-test-kv.vault.azure.net'
const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status, headers })

function fakeVault() {
  const live = new Map<string, string[]>()
  const deleted = new Map<string, string[]>()
  const once = new Map<string, Response[]>()
  const calls: { method: string; url: URL; body?: string; headers: Record<string, string> }[] = []
  let purgeConflicts = 0
  const fetch = vi.fn(async (input: string, init: any = {}) => {
    const url = new URL(input)
    const method = init.method || 'GET'
    calls.push({ method, url, body: init.body, headers: init.headers || {} })
    if (url.hostname === '169.254.169.254') return res(200, { access_token: 'mi-token', expires_in: '3600' })
    if (url.pathname.endsWith('/oauth2/v2.0/token')) return res(200, { access_token: 'wi-token', expires_in: 3600 })
    const queued = once.get(`${method} ${url.pathname}`)?.shift()
    if (queued) return queued
    const m = /^\/(secrets|deletedsecrets)\/([^/]+)(\/recover)?$/.exec(url.pathname)!
    const [, kind, name, recover] = m
    const missing = res(404, { error: { code: 'SecretNotFound', message: `A secret with (name/id) ${name} was not found in this key vault.` } })
    if (kind === 'secrets') {
      if (method === 'GET') return live.has(name) ? res(200, { value: live.get(name)!.at(-1), id: `${VAULT}/secrets/${name}/v1` }) : missing
      if (method === 'PUT') {
        if (deleted.has(name)) return res(409, { error: { code: 'Conflict', message: `Secret ${name} is currently in a deleted but recoverable state, and its name cannot be reused.` } })
        live.set(name, [...(live.get(name) || []), JSON.parse(init.body).value])
        return res(200, { value: live.get(name)!.at(-1) })
      }
      if (method === 'DELETE') {
        if (!live.has(name)) return missing
        deleted.set(name, live.get(name)!)
        live.delete(name)
        return res(200, { recoveryId: `${VAULT}/deletedsecrets/${name}` })
      }
    }
    if (method === 'GET') return deleted.has(name) ? res(200, { recoveryId: name }) : missing
    if (method === 'DELETE') {
      if (purgeConflicts > 0) {
        purgeConflicts--
        return res(409, { error: { code: 'Conflict', message: `Secret ${name} is currently being deleted.` } })
      }
      return deleted.delete(name) ? res(204) : missing
    }
    if (method === 'POST' && recover) {
      if (!deleted.has(name)) return missing
      live.set(name, deleted.get(name)!)
      deleted.delete(name)
      return res(200, { value: 'recovered' })
    }
    return res(400, { error: { message: 'unexpected' } })
  })
  const vaultCalls = () => calls.filter((c) => c.url.origin === VAULT).map((c) => `${c.method} ${c.url.pathname}`)
  return {
    live,
    deleted,
    once,
    calls,
    vaultCalls,
    fetch,
    setPurgeConflicts: (n: number) => (purgeConflicts = n),
    opts: (env: Record<string, string> = {}) => ({ backend: 'keyvault', env: { AZURE_KEY_VAULT_URL: VAULT, ...env }, fetch: fetch as any, settleMs: 0, pollMs: 0 }),
  }
}

describe('secretsBackend', () => {
  it('defaults to aws and accepts the Key Vault aliases', async () => {
    const m = await load()
    expect(m.secretsBackend({})).toBe('aws')
    expect(m.secretsBackend({ SECRETS_BACKEND: 'aws' })).toBe('aws')
    expect(m.secretsBackend({ SECRETS_BACKEND: 'secretsmanager' })).toBe('aws')
    for (const v of ['keyvault', 'KeyVault', 'key-vault', 'azure']) expect(m.secretsBackend({ SECRETS_BACKEND: v })).toBe('keyvault')
  })

  it('rejects anything else', async () => {
    const m = await load()
    expect(() => m.secretsBackend({ SECRETS_BACKEND: 'vault' })).toThrow('SECRETS_BACKEND must be aws or keyvault')
  })
})

describe('keyVaultName', () => {
  it('maps Secrets Manager names to letters, digits and dashes', async () => {
    const m = await load()
    expect(m.keyVaultName('jeffi/production')).toBe('jeffi-production')
    expect(m.keyVaultName('jeffi/tenant-db/acme')).toBe('jeffi-tenant-db-acme')
    expect(m.keyVaultName('jeffi/messaging/local')).toBe('jeffi-messaging-local')
    expect(m.keyVaultName('jeffi/production/k3s')).toBe('jeffi-production-k3s')
    expect(m.keyVaultName('a_b.c@d')).toBe('a-b-c-d')
    expect(m.keyVaultName('already-fine-123')).toBe('already-fine-123')
  })

  it('takes the name out of a Secrets Manager ARN, without its random suffix', async () => {
    const m = await load()
    expect(m.keyVaultName('arn:aws:secretsmanager:us-east-1:123456789012:secret:jeffi/tenant-db/acme-AbC123')).toBe('jeffi-tenant-db-acme')
  })

  it('refuses names Key Vault cannot hold', async () => {
    const m = await load()
    expect(() => m.keyVaultName('')).toThrow('cannot be a Key Vault secret name')
    expect(() => m.keyVaultName('x'.repeat(128))).toThrow('cannot be a Key Vault secret name')
  })
})

describe('keyVaultUrl', () => {
  it('reads AZURE_KEY_VAULT_URL (trailing slash dropped) or builds it from AZURE_KEY_VAULT_NAME', async () => {
    const m = await load()
    expect(m.keyVaultUrl({ AZURE_KEY_VAULT_URL: `${VAULT}/` })).toBe(VAULT)
    expect(m.keyVaultUrl({ AZURE_KEY_VAULT_NAME: 'jeffi-prod-kv' })).toBe('https://jeffi-prod-kv.vault.azure.net')
    expect(() => m.keyVaultUrl({})).toThrow('Key Vault not configured')
  })
})

describe('AWS Secrets Manager backend', () => {
  const aws = (m: Mod, region = 'ap-south-1') => m.createSecretsClient({ backend: 'aws', region })

  it('reads a string secret in the given region', async () => {
    const m = await load()
    sm.send.mockResolvedValue({ SecretString: '{"a":"1"}' })
    const c = aws(m)
    expect(c.backend).toBe('aws')
    await expect(c.get('jeffi/production')).resolves.toBe('{"a":"1"}')
    expect(sent()).toEqual([{ cmd: 'Get', SecretId: 'jeffi/production' }])
    expect(sm.regions).toEqual(['ap-south-1'])
  })

  it('falls back to AWS_REGION, then us-east-1', async () => {
    const m = await load()
    sm.send.mockResolvedValue({ SecretString: 'x' })
    await m.createSecretsClient({ backend: 'aws', env: { AWS_REGION: 'eu-west-1' } }).get('n')
    await m.createSecretsClient({ backend: 'aws', env: {} }).get('n')
    expect(sm.regions).toEqual(['eu-west-1', 'us-east-1'])
  })

  it('decodes a binary secret, and an empty one is ""', async () => {
    const m = await load()
    sm.send.mockResolvedValueOnce({ SecretBinary: new TextEncoder().encode('bin') }).mockResolvedValueOnce({})
    const c = aws(m)
    await expect(c.get('b')).resolves.toBe('bin')
    await expect(c.get('e')).resolves.toBe('')
  })

  it.each([
    ['ResourceNotFoundException', 'Secrets Manager can’t find the specified secret.', 'NotFound'],
    ['InvalidRequestException', "You can't perform this operation on the secret because it was marked for deletion.", 'Deleted'],
    ['AccessDeniedException', 'not authorized', 'Denied'],
    ['ResourceExistsException', 'exists', 'Exists'],
    ['ThrottlingException', 'slow down', 'Backend'],
  ])('maps %s to %s', async (name, message, code) => {
    const m = await load()
    sm.send.mockRejectedValue(awsErr(name, message))
    const err: any = await aws(m).get('jeffi/x').catch((e) => e)
    expect(m.isSecretError(err, code as any)).toBe(true)
    expect(err.secret).toBe('jeffi/x')
    expect(err.message).toContain(name)
    expect(err.cause?.name).toBe(name)
  })

  it('put overwrites, and creates when the secret does not exist', async () => {
    const m = await load()
    sm.send.mockResolvedValueOnce({}).mockRejectedValueOnce(awsErr('ResourceNotFoundException')).mockResolvedValueOnce({})
    const c = aws(m)
    await c.put('a', 'v1')
    await c.put('b', 'v2')
    expect(sent()).toEqual([
      { cmd: 'Put', SecretId: 'a', SecretString: 'v1' },
      { cmd: 'Put', SecretId: 'b', SecretString: 'v2' },
      { cmd: 'Create', Name: 'b', SecretString: 'v2' },
    ])
  })

  it('put surfaces other errors', async () => {
    const m = await load()
    sm.send.mockRejectedValue(awsErr('InvalidRequestException', 'marked for deletion'))
    await expect(aws(m).put('a', 'v')).rejects.toMatchObject({ code: 'Deleted' })
  })

  it('create returns the value, or throws Exists', async () => {
    const m = await load()
    sm.send.mockResolvedValueOnce({}).mockRejectedValueOnce(awsErr('ResourceExistsException'))
    const c = aws(m)
    await expect(c.create('a', 'v')).resolves.toBe('v')
    await expect(c.create('a', 'w')).rejects.toMatchObject({ code: 'Exists' })
    expect(sent()[0]).toEqual({ cmd: 'Create', Name: 'a', SecretString: 'v' })
  })

  it('remove schedules deletion with a recovery window; missing or already scheduled is success', async () => {
    const m = await load()
    sm.send
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(awsErr('ResourceNotFoundException'))
      .mockRejectedValueOnce(awsErr('InvalidRequestException', 'already scheduled for deletion'))
    const c = aws(m)
    await c.remove('a', { recoveryDays: 7 })
    await c.remove('b')
    await c.remove('c')
    expect(sent()[0]).toEqual({ cmd: 'Delete', SecretId: 'a', RecoveryWindowInDays: 7 })
  })

  it('force remove deletes with no recovery, restoring one already scheduled first', async () => {
    const m = await load()
    sm.send
      .mockRejectedValueOnce(awsErr('InvalidRequestException', 'You can’t delete a secret that is scheduled for deletion'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
    await aws(m).remove('jeffi/tenant-db/acme', { force: true })
    expect(sent()).toEqual([
      { cmd: 'Delete', SecretId: 'jeffi/tenant-db/acme', ForceDeleteWithoutRecovery: true },
      { cmd: 'Restore', SecretId: 'jeffi/tenant-db/acme' },
      { cmd: 'Delete', SecretId: 'jeffi/tenant-db/acme', ForceDeleteWithoutRecovery: true },
    ])
  })

  it('remove surfaces other errors', async () => {
    const m = await load()
    sm.send.mockRejectedValue(awsErr('AccessDeniedException'))
    await expect(aws(m).remove('a')).rejects.toMatchObject({ code: 'Denied' })
  })

  it('restore sends RestoreSecret', async () => {
    const m = await load()
    sm.send.mockResolvedValue({})
    await aws(m).restore('a')
    expect(sent()).toEqual([{ cmd: 'Restore', SecretId: 'a' }])
  })
})

describe('Azure Key Vault backend', () => {
  it('reads by the mapped name with a managed-identity token from IMDS, cached', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('jeffi-tenant-db-acme', ['{"password":"p"}'])
    const c = m.createSecretsClient(kv.opts())
    expect(c.backend).toBe('keyvault')
    await expect(c.get('jeffi/tenant-db/acme')).resolves.toBe('{"password":"p"}')
    await c.get('jeffi/tenant-db/acme')
    const imds = kv.calls.filter((x) => x.url.hostname === '169.254.169.254')
    expect(imds).toHaveLength(1)
    expect(imds[0].headers).toMatchObject({ Metadata: 'true' })
    expect(imds[0].url.searchParams.get('resource')).toBe('https://vault.azure.net')
    expect(imds[0].url.searchParams.get('client_id')).toBeNull()
    const vault = kv.calls.find((x) => x.url.origin === VAULT)!
    expect(vault.url.searchParams.get('api-version')).toBe('7.4')
    expect(vault.headers.authorization).toBe('Bearer mi-token')
  })

  it('asks IMDS for a user-assigned identity when AZURE_CLIENT_ID is set', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('n', ['v'])
    await m.createSecretsClient(kv.opts({ AZURE_CLIENT_ID: 'uami-1' })).get('n')
    expect(kv.calls[0].url.searchParams.get('client_id')).toBe('uami-1')
  })

  it('uses workload identity (federated token file) when configured', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('jeffi-production', ['{}'])
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-wi-'))
    fs.writeFileSync(path.join(dir, 'token'), 'cluster.jwt.sig\n')
    const env = { AZURE_FEDERATED_TOKEN_FILE: path.join(dir, 'token'), AZURE_CLIENT_ID: 'app-1', AZURE_TENANT_ID: 'tenant-1', AZURE_AUTHORITY_HOST: 'https://login.example.test' }
    await m.createSecretsClient(kv.opts(env)).get('jeffi/production')
    const tok = kv.calls[0]
    expect(tok.method).toBe('POST')
    expect(tok.url.href).toBe('https://login.example.test/tenant-1/oauth2/v2.0/token')
    const form = new URLSearchParams(tok.body)
    expect(Object.fromEntries(form)).toMatchObject({
      client_id: 'app-1',
      scope: 'https://vault.azure.net/.default',
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: 'cluster.jwt.sig',
    })
    expect(kv.calls.find((x) => x.url.origin === VAULT)!.headers.authorization).toBe('Bearer wi-token')
    expect(kv.calls.some((x) => x.url.hostname === '169.254.169.254')).toBe(false)
  })

  it('fails clearly when no token can be had', async () => {
    const m = await load()
    const fetch = vi.fn(async () => res(400, { error: 'invalid_request', error_description: 'Identity not found' }))
    const c = m.createSecretsClient({ backend: 'keyvault', env: { AZURE_KEY_VAULT_URL: VAULT }, fetch: fetch as any })
    await expect(c.get('n')).rejects.toThrow('Azure managed identity token failed: Identity not found')
  })

  it('refreshes the token once on a 401', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('n', ['v'])
    kv.once.set('GET /secrets/n', [res(401, { error: { code: 'Unauthorized', message: 'expired' } })])
    await expect(m.createSecretsClient(kv.opts()).get('n')).resolves.toBe('v')
    expect(kv.calls.filter((x) => x.url.hostname === '169.254.169.254')).toHaveLength(2)
  })

  it('NotFound when missing, Deleted when soft-deleted, Denied on 403', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.deleted.set('gone', ['x'])
    kv.once.set('GET /secrets/locked', [res(403, { error: { code: 'Forbidden', message: 'ForbiddenByRbac' } })])
    const c = m.createSecretsClient(kv.opts())
    await expect(c.get('missing')).rejects.toMatchObject({ name: 'SecretError', code: 'NotFound', secret: 'missing' })
    await expect(c.get('gone')).rejects.toMatchObject({ code: 'Deleted' })
    await expect(c.get('locked')).rejects.toMatchObject({ code: 'Denied', message: expect.stringContaining('ForbiddenByRbac') })
  })

  it('put writes a new version; a soft-deleted name is Deleted; other failures surface', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.deleted.set('gone', ['x'])
    kv.once.set('PUT /secrets/bad', [res(400, { error: { code: 'BadParameter', message: 'nope' } })])
    const c = m.createSecretsClient(kv.opts())
    await c.put('jeffi/a', 'v1')
    await c.put('jeffi/a', 'v2')
    expect(kv.live.get('jeffi-a')).toEqual(['v1', 'v2'])
    const put = kv.calls.find((x) => x.method === 'PUT')!
    expect(JSON.parse(put.body!)).toEqual({ value: 'v1' })
    expect(put.headers['content-type']).toBe('application/json')
    await expect(c.put('gone', 'v')).rejects.toMatchObject({ code: 'Deleted' })
    await expect(c.put('bad', 'v')).rejects.toMatchObject({ code: 'Backend' })
  })

  it('create stores a new secret and returns it; an existing one is Exists', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('taken', ['theirs'])
    const c = m.createSecretsClient(kv.opts())
    await expect(c.create('jeffi/new', 'mine')).resolves.toBe('mine')
    expect(kv.live.get('jeffi-new')).toEqual(['mine'])
    await expect(c.create('taken', 'mine')).rejects.toMatchObject({ code: 'Exists' })
    expect(kv.live.get('taken')).toEqual(['theirs'])
  })

  it('create loses to a concurrent writer: Exists, and the caller reads theirs', async () => {
    const m = await load()
    const kv = fakeVault()
    // The re-read after our write sees another writer's later version.
    kv.once.set('GET /secrets/race', [res(404, { error: { code: 'SecretNotFound', message: 'not found' } }), res(200, { value: 'theirs' })])
    await expect(m.createSecretsClient(kv.opts()).create('race', 'mine')).rejects.toMatchObject({ code: 'Exists' })
  })

  it('create on a soft-deleted name is Deleted (restore it first)', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.deleted.set('gone', ['old'])
    await expect(m.createSecretsClient(kv.opts()).create('gone', 'v')).rejects.toMatchObject({ code: 'Deleted' })
  })

  it('remove soft-deletes; missing is success', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('jeffi-tenant-db-acme', ['x'])
    const c = m.createSecretsClient(kv.opts())
    await c.remove('jeffi/tenant-db/acme', { recoveryDays: 7 })
    await c.remove('missing')
    expect(kv.deleted.has('jeffi-tenant-db-acme')).toBe(true)
    expect(kv.vaultCalls()).toEqual(['DELETE /secrets/jeffi-tenant-db-acme', 'DELETE /secrets/missing'])
  })

  it('force remove purges, waiting out an in-progress delete', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('a', ['x'])
    kv.setPurgeConflicts(2)
    await m.createSecretsClient(kv.opts()).remove('a', { force: true })
    expect(kv.live.has('a') || kv.deleted.has('a')).toBe(false)
    expect(kv.vaultCalls()).toEqual(['DELETE /secrets/a', 'DELETE /deletedsecrets/a', 'DELETE /deletedsecrets/a', 'DELETE /deletedsecrets/a'])
  })

  it('force remove purges one already soft-deleted, and a fully missing one is success', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.deleted.set('old', ['x'])
    const c = m.createSecretsClient(kv.opts())
    await c.remove('old', { force: true })
    await c.remove('never', { force: true })
    expect(kv.deleted.has('old')).toBe(false)
  })

  it('force remove surfaces a refused purge (purge protection)', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('a', ['x'])
    kv.once.set('DELETE /deletedsecrets/a', [res(403, { error: { code: 'Forbidden', message: 'purge protection' } })])
    await expect(m.createSecretsClient(kv.opts()).remove('a', { force: true })).rejects.toMatchObject({ code: 'Denied' })
  })

  it('restore recovers and waits until the secret reads again', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.deleted.set('jeffi-tenant-db-acme', ['{"password":"p"}'])
    kv.once.set('GET /secrets/jeffi-tenant-db-acme', [res(404, { error: { code: 'SecretNotFound', message: 'recovering' } })])
    const c = m.createSecretsClient(kv.opts())
    await c.restore('jeffi/tenant-db/acme')
    await expect(c.get('jeffi/tenant-db/acme')).resolves.toBe('{"password":"p"}')
    await expect(c.restore('never-deleted')).rejects.toMatchObject({ code: 'NotFound' })
  })

  it('retries throttling and server errors', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('n', ['v'])
    kv.once.set('GET /secrets/n', [res(503, { error: { message: 'busy' } }, { 'retry-after': '0.001' })])
    await expect(m.createSecretsClient(kv.opts()).get('n')).resolves.toBe('v')
    expect(kv.vaultCalls()).toEqual(['GET /secrets/n', 'GET /secrets/n'])
  })
})

describe('secrets() and the database secret cache', () => {
  it('secrets() follows SECRETS_BACKEND and caches a client per backend and region', async () => {
    const m = await load()
    delete process.env.SECRETS_BACKEND
    expect(m.secrets('us-east-1')).toBe(m.secrets('us-east-1'))
    expect(m.secrets('us-east-1').backend).toBe('aws')
    process.env.SECRETS_BACKEND = 'keyvault'
    process.env.AZURE_KEY_VAULT_NAME = 'jeffi-prod-kv'
    expect(m.secrets('us-east-1').backend).toBe('keyvault')
  })

  it('fetchDbSecret reads {username,password,database} once per 5 minutes; forgetDbSecret drops it', async () => {
    const m = await load()
    delete process.env.SECRETS_BACKEND
    sm.send.mockResolvedValue({ SecretString: JSON.stringify({ username: 'jeffi', password: 'pw', database: 'jeffi_stores' }) })
    const a = await m.fetchDbSecret('jeffi/tenant-db/acme', 'us-east-1')
    expect(a).toMatchObject({ username: 'jeffi', password: 'pw', database: 'jeffi_stores' })
    await m.fetchDbSecret('jeffi/tenant-db/acme', 'us-east-1')
    expect(sm.send).toHaveBeenCalledTimes(1)
    m.forgetDbSecret('jeffi/tenant-db/acme')
    await m.fetchDbSecret('jeffi/tenant-db/acme', 'us-east-1')
    expect(sm.send).toHaveBeenCalledTimes(2)
  })

  it('fetchDbSecret refuses a secret without a password', async () => {
    const m = await load()
    delete process.env.SECRETS_BACKEND
    sm.send.mockResolvedValue({ SecretString: '{"username":"x"}' })
    await expect(m.fetchDbSecret('jeffi/tenant-db/x')).rejects.toThrow('has no password field')
  })

  it('getSecretJson parses the blob, and rejects one that is not JSON', async () => {
    const m = await load()
    delete process.env.SECRETS_BACKEND
    sm.send.mockResolvedValueOnce({ SecretString: '{"A":"1"}' }).mockResolvedValueOnce({ SecretString: 'not json' })
    await expect(m.getSecretJson('jeffi/production')).resolves.toEqual({ A: '1' })
    await expect(m.getSecretJson('jeffi/production', { backend: 'aws' })).rejects.toMatchObject({ code: 'Invalid' })
  })
})

describe('loadSecretEnv (boot loader entry)', () => {
  it('returns the string values of the JSON blob', async () => {
    const m = await load()
    sm.send.mockResolvedValue({ SecretString: JSON.stringify({ JWT_SECRET: 'j', PORT: 3000, NESTED: { a: 1 }, DB: 'postgres://x' }) })
    await expect(m.loadSecretEnv('jeffi/production', { backend: 'aws', region: 'us-east-1' })).resolves.toEqual({
      id: 'jeffi/production',
      backend: 'aws',
      values: { JWT_SECRET: 'j', DB: 'postgres://x' },
    })
  })

  it('reads the fallback when the primary is missing or denied', async () => {
    const m = await load()
    sm.send
      .mockRejectedValueOnce(awsErr('ResourceNotFoundException'))
      .mockResolvedValueOnce({ SecretString: '{"A":"fb"}' })
      .mockRejectedValueOnce(awsErr('AccessDeniedException'))
      .mockResolvedValueOnce({ SecretString: '{"A":"fb2"}' })
    const r = await m.loadSecretEnv('jeffi/acme/production', { backend: 'aws', fallbackId: 'jeffi/production' })
    expect(r).toMatchObject({ id: 'jeffi/production', values: { A: 'fb' } })
    const r2 = await m.loadSecretEnv('jeffi/acme/production', { backend: 'aws', fallbackId: 'jeffi/production' })
    expect(r2.values).toEqual({ A: 'fb2' })
  })

  it('does not fall back on other errors, or without a fallback', async () => {
    const m = await load()
    sm.send.mockRejectedValueOnce(awsErr('ThrottlingException')).mockRejectedValueOnce(awsErr('ResourceNotFoundException'))
    await expect(m.loadSecretEnv('a', { backend: 'aws', fallbackId: 'b' })).rejects.toMatchObject({ code: 'Backend' })
    await expect(m.loadSecretEnv('a', { backend: 'aws' })).rejects.toMatchObject({ code: 'NotFound' })
    expect(sm.send).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['', 'is empty'],
    ['not json', 'is not valid JSON'],
    ['[1,2]', 'is not a JSON object'],
    ['null', 'is not a JSON object'],
  ])('rejects %j', async (raw, msg) => {
    const m = await load()
    sm.send.mockResolvedValue({ SecretString: raw })
    await expect(m.loadSecretEnv('jeffi/production', { backend: 'aws' })).rejects.toMatchObject({ code: 'Invalid', message: expect.stringContaining(msg) })
  })

  it('reads the dash-named copy from Key Vault', async () => {
    const m = await load()
    const kv = fakeVault()
    kv.live.set('jeffi-production', [JSON.stringify({ JWT_SECRET: 'kv' })])
    await expect(m.loadSecretEnv('jeffi/production', kv.opts())).resolves.toEqual({ id: 'jeffi/production', backend: 'keyvault', values: { JWT_SECRET: 'kv' } })
  })
})

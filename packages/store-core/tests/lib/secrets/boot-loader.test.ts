// @vitest-environment node
// deploy/load-secrets.mjs end to end: a real `node` process against a local Secrets Manager (AWS_ENDPOINT_URL_*)
// or a local IMDS + Key Vault, chaining into a stub app that prints the env it inherited.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../../..')
const LOADER = path.join(ROOT, 'deploy/load-secrets.mjs')

type Req = { url: string; target?: string; body: string }
let server: http.Server
let base = ''
let reqs: Req[] = []
let sm: Record<string, string> = {}
let kv: Record<string, string> = {}
let app = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const target = req.headers['x-amz-target'] as string | undefined
      reqs.push({ url: req.url!, target, body })
      const json = (status: number, o: unknown, type = 'application/json') => {
        res.writeHead(status, { 'content-type': type })
        res.end(JSON.stringify(o))
      }
      if (target === 'secretsmanager.GetSecretValue') {
        const id = JSON.parse(body).SecretId
        if (id in sm) return json(200, { Name: id, SecretString: sm[id] }, 'application/x-amz-json-1.1')
        return json(400, { __type: 'ResourceNotFoundException', Message: "Secrets Manager can't find the specified secret." }, 'application/x-amz-json-1.1')
      }
      if (req.url!.startsWith('/metadata/identity/oauth2/token')) return json(200, { access_token: 'mi', expires_in: '3600' })
      const m = /^\/secrets\/([^?]+)\?api-version=7\.4$/.exec(req.url!)
      if (m && req.headers.authorization === 'Bearer mi') {
        if (m[1] in kv) return json(200, { value: kv[m[1]] })
        return json(404, { error: { code: 'SecretNotFound', message: `A secret with (name/id) ${m[1]} was not found in this key vault.` } })
      }
      json(400, { error: { message: 'unexpected' } })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as any).port}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-loader-'))
  app = path.join(dir, 'app.mjs')
  fs.writeFileSync(app, "process.stdout.write('APP ' + JSON.stringify({ A: process.env.A, B: process.env.B, N: process.env.N }) + '\\n')\n")
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
beforeEach(() => {
  reqs = []
  sm = {}
  kv = {}
})

function run(env: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(AWS_|AZURE_|SM_|SECRETS_BACKEND|ALLOW_ENV_FALLBACK|NODE_ENV$|A$|B$|N$)/.test(k)))
  const full = {
    ...clean,
    NODE_ENV: 'production',
    SPAWN_APP: '1',
    APP_ENTRY: app,
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_CONFIG_FILE: '/nonexistent',
    AWS_SHARED_CREDENTIALS_FILE: '/nonexistent',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_ENDPOINT_URL_SECRETS_MANAGER: base,
    AZURE_IMDS_ENDPOINT: base,
    ...env,
  }
  return new Promise((resolve) => {
    execFile(process.execPath, [LOADER], { env: full, cwd: ROOT, timeout: 30_000 }, (e, out, err) => resolve({ code: e ? ((e as any).code ?? 1) : 0, out, err }))
  })
}

describe('deploy/load-secrets.mjs', () => {
  it('Secrets Manager: falls back with the line it always printed, never overwrites set env, then starts the app', async () => {
    sm['jeffi/production'] = JSON.stringify({ A: 'from-sm', B: 'not-this', N: 3 })
    const r = await run({ SM_SECRET_ID: 'jeffi/store', SM_SECRET_FALLBACK_ID: 'jeffi/production', B: 'pod' })
    expect(r.err).toBe('[load-secrets] "jeffi/store" unavailable (ResourceNotFoundException); using "jeffi/production"\n')
    expect(r.out).toBe('[load-secrets] Loaded 1 secrets from "jeffi/production" (1 skipped — already set)\nAPP {"A":"from-sm","B":"pod"}\n')
    expect(r.code).toBe(0)
    expect(reqs.map((q) => JSON.parse(q.body).SecretId)).toEqual(['jeffi/store', 'jeffi/production'])
  }, 40_000)

  it('Secrets Manager: a missing secret without a fallback fails the boot with the SDK message', async () => {
    const r = await run({ SM_SECRET_ID: 'jeffi/nope' })
    expect(r.code).toBe(1)
    expect(r.err).toBe('[load-secrets] Failed to fetch "jeffi/nope" from Secrets Manager: Secrets Manager can\'t find the specified secret.\nSet ALLOW_ENV_FALLBACK=true to skip SM.\n')
    expect(r.out).toBe('')
  }, 40_000)

  it('Secrets Manager: an empty secret, and one that is not JSON', async () => {
    sm['jeffi/empty'] = ''
    sm['jeffi/bad'] = 'nope'
    expect((await run({ SM_SECRET_ID: 'jeffi/empty' })).err).toBe('[load-secrets] Secret "jeffi/empty" exists but SecretString is empty\n')
    expect((await run({ SM_SECRET_ID: 'jeffi/empty', ALLOW_ENV_FALLBACK: 'true' })).err).toBe('[load-secrets] Secret "jeffi/empty" exists but SecretString is empty — continuing\n')
    const bad = await run({ SM_SECRET_ID: 'jeffi/bad' })
    expect(bad).toMatchObject({ code: 1, err: '[load-secrets] SecretString for "jeffi/bad" is not valid JSON\n' })
  }, 40_000)

  it('Key Vault: reads the dash-named copy with the VM identity', async () => {
    kv['jeffi-production'] = JSON.stringify({ A: 'from-kv' })
    const r = await run({ SECRETS_BACKEND: 'keyvault', AZURE_KEY_VAULT_URL: base, SM_SECRET_ID: 'jeffi/production' })
    expect(r.out).toBe('[load-secrets] Loaded 1 secrets from "jeffi/production" (0 skipped — already set)\nAPP {"A":"from-kv"}\n')
    expect(reqs.some((q) => q.target)).toBe(false)
  }, 40_000)

  it('Key Vault: a missing secret names both stores', async () => {
    const r = await run({ SECRETS_BACKEND: 'keyvault', AZURE_KEY_VAULT_URL: base, SM_SECRET_ID: 'jeffi/store' })
    expect(r.code).toBe(1)
    expect(r.err).toContain('[load-secrets] Failed to fetch "jeffi/store" (Key Vault "jeffi-store") from Key Vault: Key Vault 404:')
  }, 40_000)

  it('SECRETS_BACKEND=env reads nothing: the pod env already holds the secret', async () => {
    const r = await run({ SECRETS_BACKEND: 'env', SM_SECRET_ID: 'jeffi/store', A: 'from-k8s-secret' })
    expect(r.out).toBe('[load-secrets] "jeffi/store" is in the environment already (SECRETS_BACKEND=env)\nAPP {"A":"from-k8s-secret"}\n')
    expect(r.code).toBe(0)
    expect(reqs).toEqual([])
  }, 40_000)
})

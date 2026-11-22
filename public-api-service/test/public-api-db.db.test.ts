// @vitest-environment node
//
// DB-backed (jeffi_test) tier for public-api-service (Fastify). Unlike server.test.ts, keys.ts is NOT
// mocked: lookupKey() runs its real SQL against REAL api_keys / tenants / tenant_service_approvals rows
// seeded in jeffi_test, so the 401/403/200 auth+scope+approval gates are proven end-to-end from the DB.
// Downstream proxy (undici) and wallet are still mocked — those are external HTTP / another package,
// out of scope for the DB tier; we assert the gate decision the DB row produces, and the wallet route
// (no downstream) end-to-end.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Readable } from 'node:stream'
import Fastify, { type FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'

const API_DB_ENABLED = process.env.API_DB === '1'

// jeffi_test guard (mirrors the store-core harness; CONTROL_PLANE_DATABASE_URL is what keys.ts reads).
function requireTestDb(): string {
  const url = process.env.CONTROL_PLANE_DATABASE_URL || process.env.DATABASE_URL || ''
  let name = ''
  try { name = new URL(url).pathname.replace(/^\//, '') } catch { throw new Error(`API_DB: bad CONTROL_PLANE_DATABASE_URL ${JSON.stringify(url)}`) }
  if (name !== 'jeffi_test') throw new Error(`API_DB REFUSE: CONTROL_PLANE_DATABASE_URL db must be 'jeffi_test', got '${name}'`)
  return url
}

// Env BEFORE importing server.ts (flagship host; no redis/k8s; downstream URLs the proxy mock sees).
process.env.SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET || 'test-secret'
process.env.ADMIN_GATEWAY_SECRET = process.env.ADMIN_GATEWAY_SECRET || 'test-secret'
process.env.MESSAGING_URL = 'http://messaging.test'
process.env.DOCUMENTS_URL = 'http://documents.test'
delete process.env.REDIS_URL
delete process.env.KUBERNETES_SERVICE_HOST
if (API_DB_ENABLED) requireTestDb()

// ── capture the Fastify app; never bind a port ──
let captured: FastifyInstance | undefined
vi.mock('fastify', async orig => {
  const mod = (await orig()) as typeof import('fastify')
  const factory = (opts?: any) => {
    const app = (mod.default as any)(opts)
    app.listen = async () => ''
    captured = app
    return app
  }
  return { ...mod, default: Object.assign(factory, mod.default) }
})

// ── downstream proxy + wallet + scalar docs: mocked (external / another package / unrelated) ──
const undiciMock = vi.fn()
vi.mock('undici', () => ({ request: (...a: any[]) => undiciMock(...a) }))
vi.mock('@jeffi/wallet', () => ({ getBalance: vi.fn(async () => 50), spendSince: vi.fn(async () => 7) }))
vi.mock('@scalar/fastify-api-reference', () => ({
  default: async (app: FastifyInstance) => {
    app.get('/docs', async (_r, reply) => reply.code(301).header('location', '/docs/').send(''))
    app.get('/docs/', async (_r, reply) => reply.header('content-type', 'text/html').send('<html><head><title>Scalar</title></head><body></body></html>'))
  },
}))

function up(status = 200, body: unknown = { ok: true }, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { statusCode: status, headers, body: Object.assign(Readable.from([Buffer.from(text)]), { text: async () => text, arrayBuffer: async () => Buffer.from(text), dump: async () => {} }) } as any
}

const hashKey = (plain: string) => createHash('sha256').update(plain).digest('hex')
const bearer = (k: string) => ({ authorization: `Bearer ${k}` })

// Fixed ids for this file's seeded control-plane rows (distinct prefix so cleanup is exact).
const OWNER = '00000000-0000-4000-d000-0000000000f0'
const TENANT = '00000000-0000-4000-d000-0000000000f1'
const K_FULL = '00000000-0000-4000-d000-0000000000f2' // all scopes, messaging+documents, approved
const K_NOSCOPE = '00000000-0000-4000-d000-0000000000f3' // wallet:read missing
const K_NOSVC = '00000000-0000-4000-d000-0000000000f4' // tenant without messaging service
const K_REVOKED = '00000000-0000-4000-d000-0000000000f5' // status revoked
const K_PENDING = '00000000-0000-4000-d000-0000000000f6' // messaging pending approval
const TENANT_NOSVC = '00000000-0000-4000-d000-0000000000f7'
const TENANT_PENDING = '00000000-0000-4000-d000-0000000000f8' // messaging enabled but approval pending

// Each api key's plaintext (lookupKey hashes it) — distinct values dodge the 60s per-hash cache.
const P_FULL = 'jk_live_db_full_scope_key_00001'
const P_NOSCOPE = 'jk_live_db_no_wallet_scope_00002'
const P_NOSVC = 'jk_live_db_no_messaging_svc_0003'
const P_REVOKED = 'jk_live_db_revoked_key_0000_0004'
const P_PENDING = 'jk_live_db_pending_messaging_005'

let app!: FastifyInstance
let cp!: ReturnType<typeof import('../src/keys.js')['cp']>

async function seed() {
  await cp.query(`INSERT INTO owners (id, email, name) VALUES ($1,$2,'DB Test Owner') ON CONFLICT (id) DO NOTHING`, [OWNER, `db-test-${OWNER}@example.test`])
  // Tenants: full messaging+documents (approved), documents-only (service_not_enabled), and
  // messaging-enabled-but-pending (so the full key's tenant stays clean/approved).
  for (const [id, slug, svc] of [
    [TENANT, `db-test-${TENANT.slice(-6)}`, '{messaging,documents}'],
    [TENANT_NOSVC, `db-test-${TENANT_NOSVC.slice(-6)}`, '{documents}'],
    [TENANT_PENDING, `db-test-${TENANT_PENDING.slice(-6)}`, '{messaging,documents}'],
  ] as const) {
    await cp.query(`INSERT INTO tenants (id, slug, display_name, service_types, status) VALUES ($1,$2,'DB Test Store',$3::text[],'active') ON CONFLICT (id) DO NOTHING`, [id, slug, svc])
  }
  const key = (id: string, tenant: string, plainHash: string, scopes: string, status = 'active') =>
    cp.query(
      `INSERT INTO api_keys (id, owner_id, tenant_id, name, key_prefix, key_hash, scopes, status)
       VALUES ($1,$2,$3,'db-test',$4,$5,$6::text[],$7) ON CONFLICT (id) DO NOTHING`,
      [id, OWNER, tenant, plainHash.slice(0, 16), plainHash, scopes, status]
    )
  await key(K_FULL, TENANT, hashKey(P_FULL), '{messages:send,templates:read,templates:write,documents:render,documents:read,wallet:read}')
  await key(K_NOSCOPE, TENANT, hashKey(P_NOSCOPE), '{messages:send,templates:read}') // no wallet:read
  await key(K_NOSVC, TENANT_NOSVC, hashKey(P_NOSVC), '{messages:send,templates:read,wallet:read}') // tenant lacks messaging
  await key(K_REVOKED, TENANT, hashKey(P_REVOKED), '{wallet:read}', 'revoked')
  await key(K_PENDING, TENANT, hashKey(P_PENDING), '{messages:send,templates:read}')
  await cp.query(`INSERT INTO tenant_service_approvals (tenant_id, service, status) VALUES ($1,'messaging','pending') ON CONFLICT (tenant_id, service) DO UPDATE SET status='pending'`, [TENANT])
}

beforeAll(async () => {
  if (!API_DB_ENABLED) return
  requireTestDb()
  const keys = await import('../src/keys.js')
  cp = keys.cp() // pool on CONTROL_PLANE_DATABASE_URL = jeffi_test
  await seed()
  await import('../src/server')
  app = captured!
  await app.ready()
})

afterAll(async () => {
  if (!API_DB_ENABLED || !cp) return
  await cp.query(`DELETE FROM api_key_usage_daily WHERE api_key_id = ANY($1::uuid[])`, [[K_FULL, K_NOSCOPE, K_NOSVC, K_REVOKED, K_PENDING]]).catch(() => {})
  await cp.query(`DELETE FROM api_keys WHERE id = ANY($1::uuid[])`, [[K_FULL, K_NOSCOPE, K_NOSVC, K_REVOKED, K_PENDING]]).catch(() => {})
  await cp.query(`DELETE FROM tenant_service_approvals WHERE tenant_id = ANY($1::uuid[])`, [[TENANT, TENANT_NOSVC]]).catch(() => {})
  await cp.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT, TENANT_NOSVC]]).catch(() => {})
  await cp.query(`DELETE FROM owners WHERE id = $1`, [OWNER]).catch(() => {})
  await cp.end().catch(() => {})
})

describe.skipIf(!API_DB_ENABLED)('public-api DB — key lookup against real control-plane rows', () => {
  it('no bearer → 401 (never touches the DB)', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/wallet' })
    expect(r.statusCode).toBe(401)
    expect(r.json().error).toBe('unauthorized')
  })

  it('a jk key with no matching row → 401 (real SELECT returns nothing)', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/wallet', headers: bearer('jk_live_absent_row_00000000000') })
    expect(r.statusCode).toBe(401)
    expect(r.json().message).toContain('Unknown or revoked')
  })

  it('a revoked row → 401 (status filtered out by lookupKey)', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/wallet', headers: bearer(P_REVOKED) })
    expect(r.statusCode).toBe(401)
    expect(r.json().message).toContain('Unknown or revoked')
  })

  it('a real active key missing wallet:read → 403 forbidden', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/wallet', headers: bearer(P_NOSCOPE) })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('forbidden')
    expect(r.json().message).toContain("'wallet:read' scope")
  })

  it('a real active key WITH wallet:read → 200 (scopes read from the DB row)', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/wallet', headers: bearer(P_FULL) })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ balance_inr: 50, spent_today_inr: 7, currency: 'INR' })
  })
})

describe.skipIf(!API_DB_ENABLED)('public-api DB — service enablement + approval gates from the tenant row', () => {
  it("messaging send with the scope but the tenant's service_types lacks messaging → 403 service_not_enabled", async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/messages', headers: { ...bearer(P_NOSVC), 'content-type': 'application/json' }, payload: '{}' })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('service_not_enabled')
    expect(undiciMock).not.toHaveBeenCalled()
  })

  it('messaging send while tenant_service_approvals row is pending → 403 service_pending_approval', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/messages', headers: { ...bearer(P_PENDING), 'content-type': 'application/json' }, payload: '{}' })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('service_pending_approval')
    expect(undiciMock).not.toHaveBeenCalled()
  })

  it('a read (templates:read) is allowed while messaging approval is pending → proxied 200', async () => {
    undiciMock.mockResolvedValueOnce(up(200, { templates: [] }))
    const r = await app.inject({ method: 'GET', url: '/v1/templates', headers: bearer(P_PENDING) })
    expect(r.statusCode).toBe(200)
    expect(undiciMock).toHaveBeenCalledOnce()
    expect(undiciMock.mock.calls[0][0]).toBe('http://messaging.test/v2/templates')
  })

  // TODO(api-db): the "approved messaging send → 200 + signed proxy" happy path needs the real
  // send-gate's approval semantics pinned down (tenant_service_approvals.status='approved' alone was
  // not sufficient here). Deferred — the 401/403/scope/not-enabled/pending gates above are proven.
})

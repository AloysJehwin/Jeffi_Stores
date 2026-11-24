import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  del: vi.fn(),
  test: vi.fn(),
  mockOrder: vi.fn(),
  queryOne: vi.fn(),
  sql: [] as string[],
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/shared/db', () => ({ queryOne: m.queryOne, queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: async () => ({ tenantId: 't1', slug: 'acme' }) }))
vi.mock('@/lib/integrations/resolve', () => ({
  IntegrationNotConnectedError: class extends Error {},
  resolveMarketplaceCreds: m.resolve,
  saveMarketplaceCreds: m.save,
  deleteMarketplaceCreds: m.del,
}))
vi.mock('@/lib/marketplace/registry', () => ({
  MARKETPLACE_FIELDS: {
    ajio: [
      { key: 'client_id', label: 'Field one' },
      { key: 'client_secret', label: 'Field two', secret: true },
    ],
  },
  getAdapter: () => ({ test: m.test }),
  sendMockTestOrder: m.mockOrder,
}))

import { GET, POST, DELETE } from '@admin/app/api/(admin)/admin/ajio/connection/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['ajio:write'] }
const CREDS = {
  mode: 'sandbox',
  fields: { client_id: 'ID-100', client_secret: 'sk-very-secret' },
  push_token: 'tok-current',
  push_token_prev: 'tok-old',
  push_token_rotated_at: new Date().toISOString(),
}
const req = (qs = '', init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://acme.jeffistores.in/api/admin/ajio/connection${qs}`, init)
const post = (qs: string, body?: unknown) => POST(req(qs, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
const deny = (status: number) => NextResponse.json({ error: 'nope' }, { status })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.resolve.mockResolvedValue({ ...CREDS, fields: { ...CREDS.fields } })
  m.queryOne.mockResolvedValue({ id: '1', at: null })
  m.test.mockResolvedValue({ ok: true })
  m.mockOrder.mockResolvedValue({ orderNumber: 'AJI-TEST-1' })
})

describe('ajio connection route', () => {
  it('rejects a caller without the scope and a plan without AJIO', async () => {
    m.requireAdminScope.mockResolvedValue(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'ajio:read')
    expect((await post('', { mode: 'mock' })).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'ajio:write')
    expect((await DELETE(req('', { method: 'DELETE' }))).status).toBe(403)
    expect(m.save).not.toHaveBeenCalled()
    expect(m.del).not.toHaveBeenCalled()

    m.requireAdminScope.mockResolvedValue(deny(401))
    expect((await GET(req())).status).toBe(401)

    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await post('', { mode: 'mock' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'AJIO needs the Pro plan.', upgradeRequired: 'pro' })
    expect(m.save).not.toHaveBeenCalled()
  })

  it('GET reports the connection without secrets or push tokens', async () => {
    const res = await GET(req())
    const text = await res.text()
    expect(res.status).toBe(200)
    for (const secret of ['sk-very-secret', 'tok-current', 'tok-old']) expect(text).not.toContain(secret)
    const body = JSON.parse(text)
    expect(body).toMatchObject({ connected: true, mode: 'sandbox', hasPushToken: true, pushUrl: 'https://acme.jeffistores.in/api/webhooks/ajio' })
    expect(body.fields).toEqual([
      { key: 'client_id', label: 'Field one', secret: false, placeholder: null, set: true, value: 'ID-100' },
      { key: 'client_secret', label: 'Field two', secret: true, placeholder: null, set: true, value: null },
    ])
  })

  it('GET answers not connected when nothing is saved', async () => {
    m.resolve.mockResolvedValue(null)
    const body = await (await GET(req())).json()
    expect(body).toMatchObject({ connected: false, mode: null, hasPushToken: false })
  })

  it('saves tested credentials, keeps a blank secret and returns the new push token once', async () => {
    const res = await post('', { mode: 'sandbox', fields: { client_id: 'ID-200', client_secret: '' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(m.test).toHaveBeenCalledTimes(1)
    expect(m.save).toHaveBeenCalledTimes(1)
    const [channel, saved] = m.save.mock.calls[0]
    expect(channel).toBe('ajio')
    expect(saved).toMatchObject({ mode: 'sandbox', fields: { client_id: 'ID-200', client_secret: 'sk-very-secret' }, push_token: 'tok-current' })
    expect(body.pushToken).toBeNull()
    expect(JSON.stringify(body)).not.toContain('sk-very-secret')
  })

  it('generates a push token on first connection', async () => {
    m.resolve.mockResolvedValue(null)
    const res = await post('', { mode: 'mock' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(m.save.mock.calls[0][1].push_token).toBe(body.pushToken)
    expect(body.pushToken).toMatch(/^[\w-]{40,}$/)
  })

  it('refuses invalid input with 400 and saves nothing', async () => {
    const badMode = await post('', { mode: 'prod' })
    expect(badMode.status).toBe(400)
    m.resolve.mockResolvedValue(null)
    const missing = await post('', { mode: 'live', fields: { client_id: 'ID-1' } })
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toContain('Field two')
    expect((await post('?action=wipe', {})).status).toBe(400)
    expect(m.save).not.toHaveBeenCalled()
    expect(m.test).not.toHaveBeenCalled()
  })

  it('does not save when AJIO rejects the details', async () => {
    m.test.mockResolvedValue({ ok: false, message: 'Bad credentials' })
    const res = await post('', { mode: 'sandbox', fields: { client_id: 'ID-200', client_secret: 'wrong' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Bad credentials')
    expect(m.save).not.toHaveBeenCalled()
  })

  it('tests without saving, and reports an adapter that throws as a failed test', async () => {
    const ok = await post('?action=test', { mode: 'sandbox' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })
    m.test.mockRejectedValue(new Error('timeout'))
    expect(await (await post('?action=test', { mode: 'sandbox' })).json()).toEqual({ ok: false, message: 'timeout' })
    expect(m.save).not.toHaveBeenCalled()
  })

  it('rotating the push token keeps the previous one for the overlap', async () => {
    const res = await post('?action=rotate-token')
    expect(res.status).toBe(200)
    const saved = m.save.mock.calls[0][1]
    expect(m.save.mock.calls[0][0]).toBe('ajio')
    expect(saved.push_token_prev).toBe('tok-current')
    expect(saved.push_token).not.toBe('tok-current')
    expect(saved.fields).toEqual(CREDS.fields)
    expect((await res.json()).pushToken).toBe(saved.push_token)
  })

  it('refuses to rotate when not connected', async () => {
    m.resolve.mockResolvedValue(null)
    expect((await post('?action=rotate-token')).status).toBe(409)
    expect(m.save).not.toHaveBeenCalled()
  })

  it('refuses a test order in live mode and sends one in sandbox', async () => {
    m.resolve.mockResolvedValue({ ...CREDS, mode: 'live' })
    expect((await post('?action=test-order')).status).toBe(409)
    expect(m.mockOrder).not.toHaveBeenCalled()
    m.resolve.mockResolvedValue({ ...CREDS })
    const sandbox = await post('?action=test-order')
    expect(sandbox.status).toBe(200)
    expect(m.mockOrder).toHaveBeenCalledWith('ajio')
    expect((await sandbox.json()).orderNumber).toBe('AJI-TEST-1')
  })

  it('DELETE removes the stored details', async () => {
    const res = await DELETE(req('', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(m.del).toHaveBeenCalledWith('ajio')
  })

  it('refuses a failed delete with 400 and the reason', async () => {
    m.del.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await DELETE(req('', { method: 'DELETE' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('db down')
  })
})

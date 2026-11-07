import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  del: vi.fn(),
  test: vi.fn(),
  mockOrder: vi.fn(),
  queryOne: vi.fn(),
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
    myntra: [
      { key: 'merchant_id', label: 'Merchant ID' },
      { key: 'secret_key', label: 'Secret key', secret: true },
    ],
    ajio: [],
  },
  getAdapter: () => ({ test: m.test }),
  sendMockTestOrder: m.mockOrder,
}))

import { GET, POST } from '@admin/app/api/(admin)/admin/myntra/connection/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['myntra:write'] }
const CREDS = {
  mode: 'sandbox',
  fields: { merchant_id: 'M-100', secret_key: 'sk-very-secret' },
  push_token: 'tok-current',
  push_token_prev: 'tok-old',
  push_token_rotated_at: new Date().toISOString(),
}
const req = (qs = '', init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://acme.jeffistores.in/api/admin/myntra/connection${qs}`, init)

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.resolve.mockResolvedValue({ ...CREDS, fields: { ...CREDS.fields } })
  m.queryOne.mockResolvedValue({ id: '1', at: null })
  m.test.mockResolvedValue({ ok: true })
  m.mockOrder.mockResolvedValue({ orderNumber: 'MYN-TEST-1' })
})

describe('myntra connection route', () => {
  it('GET reports the connection without secrets or push tokens', async () => {
    const res = await GET(req())
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'myntra:read')
    for (const secret of ['sk-very-secret', 'tok-current', 'tok-old']) expect(text).not.toContain(secret)
    const body = JSON.parse(text)
    expect(body).toMatchObject({ connected: true, mode: 'sandbox', hasPushToken: true, pushUrl: 'https://acme.jeffistores.in/api/webhooks/myntra' })
    expect(body.fields).toEqual([
      { key: 'merchant_id', label: 'Merchant ID', secret: false, placeholder: null, set: true, value: 'M-100' },
      { key: 'secret_key', label: 'Secret key', secret: true, placeholder: null, set: true, value: null },
    ])
  })

  it('rotating the push token keeps the previous one for the overlap', async () => {
    const res = await POST(req('?action=rotate-token', { method: 'POST' }))
    expect(res.status).toBe(200)
    const saved = m.save.mock.calls[0][1]
    expect(m.save.mock.calls[0][0]).toBe('myntra')
    expect(saved.push_token_prev).toBe('tok-current')
    expect(saved.push_token).not.toBe('tok-current')
    expect(saved.fields).toEqual(CREDS.fields)
    expect((await res.json()).pushToken).toBe(saved.push_token)
  })

  it('refuses a test order in live mode and sends one in sandbox', async () => {
    m.resolve.mockResolvedValue({ ...CREDS, mode: 'live' })
    const live = await POST(req('?action=test-order', { method: 'POST' }))
    expect(live.status).toBe(409)
    expect(m.mockOrder).not.toHaveBeenCalled()

    m.resolve.mockResolvedValue({ ...CREDS })
    const sandbox = await POST(req('?action=test-order', { method: 'POST' }))
    expect(sandbox.status).toBe(200)
    expect(m.mockOrder).toHaveBeenCalledWith('myntra')
    expect((await sandbox.json()).orderNumber).toBe('MYN-TEST-1')
  })
})

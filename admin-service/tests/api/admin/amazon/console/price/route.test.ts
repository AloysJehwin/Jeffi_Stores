import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return { NotConnected, requireAdminScope: vi.fn(), planGate: vi.fn(), change: vi.fn() }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/amazon/console', () => ({ changeAmazonPrice: m.change }))

import { POST } from '@admin/app/api/(admin)/admin/amazon/console/price/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon_pricing:write'] }
const post = (body: unknown) =>
  POST(new NextRequest('https://acme.jeffistores.in/api/admin/amazon/console/price', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
const deny = (status: number) => NextResponse.json({ error: 'nope' }, { status })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.change.mockResolvedValue({ ok: true, preview: false, summary: 'Price set', problems: [] })
})

describe('amazon console price route', () => {
  it('needs amazon_pricing:write and the plan, and changes nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(deny(403))
    expect((await post({ sku: 'S1', price: 499 })).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon_pricing:write')
    m.requireAdminScope.mockResolvedValue(deny(401))
    expect((await post({ sku: 'S1', price: 499 })).status).toBe(401)
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await post({ sku: 'S1', price: 499 })
    expect(res.status).toBe(403)
    expect((await res.json()).upgradeRequired).toBe('pro')
    expect(m.planGate).toHaveBeenCalledWith('amazon_pricing:write')
    expect(m.change).not.toHaveBeenCalled()
  })

  it('rejects a bad body with 400 before Amazon is called', async () => {
    for (const body of [{}, { sku: '', price: 5 }, { sku: 'S1', price: -1 }, { sku: 'S1', price: 0 }, { sku: 'S1', price: 'x' }, { sku: 'S1', price: 20_000_000 }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(m.change).not.toHaveBeenCalled()
  })

  it('applies a price change as the signed-in admin', async () => {
    const res = await post({ sku: 'S1', price: 499, allowBelowFloor: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, summary: 'Price set' })
    expect(m.change).toHaveBeenCalledWith('S1', 499, { adminId: 'a1', email: 'owner@crm.test' }, false, { allowBelowFloor: true })
  })

  it('previews without applying and answers 200', async () => {
    m.change.mockResolvedValue({ ok: false, preview: true, summary: 'Margin 12%', problems: [] })
    const res = await post({ sku: 'S1', price: 499, preview: true })
    expect(res.status).toBe(200)
    expect(m.change).toHaveBeenCalledWith('S1', 499, expect.anything(), true, { allowBelowFloor: undefined })
  })

  it('answers 400 when the change is refused', async () => {
    m.change.mockResolvedValue({ ok: false, preview: false, summary: 'Below floor', problems: ['Below the price floor.'] })
    const res = await post({ sku: 'S1', price: 5 })
    expect(res.status).toBe(400)
    expect((await res.json()).problems).toEqual(['Below the price floor.'])
  })

  it('maps Amazon failures to a status: not connected 409, 4xx 400, 5xx 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.change.mockRejectedValueOnce(new m.NotConnected('x'))
    const nc = await post({ sku: 'S1', price: 499 })
    expect(nc.status).toBe(409)
    expect((await nc.json()).error).toBe('Connect Amazon first.')
    m.change.mockRejectedValueOnce(Object.assign(new Error('Throttled'), { httpStatus: 429 }))
    expect((await post({ sku: 'S1', price: 499 })).status).toBe(400)
    m.change.mockRejectedValueOnce(Object.assign(new Error('Amazon down'), { httpStatus: 503 }))
    expect((await post({ sku: 'S1', price: 499 })).status).toBe(502)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const auth = vi.hoisted(() => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
const addon = vi.hoisted(() => ({ getMessagingAddonPricing: vi.fn(), invalidateMessagingAddonPricing: vi.fn() }))
vi.mock('@/lib/billing/messaging-addon', () => ({ ...addon, DEFAULT_MESSAGING_COST_LINES: [{ label: 'Number', inrMonth: 100 }], DEFAULT_MESSAGING_MARGIN_PCT: 25 }))

import { GET, PUT } from '@controller/app/api/(admin)/admin/ecom/messaging-addon-pricing/route'

const get = () => GET(new NextRequest('http://localhost/api/admin/ecom/messaging-addon-pricing'))
const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/admin/ecom/messaging-addon-pricing', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }))
const good = { costLines: [{ label: 'Number', inrMonth: 120 }], marginPct: 30 }

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireAdminScope.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  addon.getMessagingAddonPricing.mockResolvedValue({ costLines: [], marginPct: 30 })
  query.mockResolvedValue({ rows: [] })
})

describe('/api/admin/ecom/messaging-addon-pricing', () => {
  it('passes the scope gate response through', async () => {
    auth.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await get()).status).toBe(403)
    expect((await put(good)).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('403s a scoped non-administrator', async () => {
    auth.requireAdminScope.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: ['ecom_billing:write'] })
    expect((await get()).status).toBe(403)
    expect((await put(good)).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('GET returns the pricing with defaults', async () => {
    expect(await (await get()).json()).toEqual({
      costLines: [], marginPct: 30, defaults: { costLines: [{ label: 'Number', inrMonth: 100 }], marginPct: 25 },
    })
  })

  it.each([[{ ...good, costLines: [] }], [{ ...good, marginPct: 501 }], [{ ...good, costLines: [{ label: '', inrMonth: 1 }] }], ['not json']])('PUT 400s for a bad body %#', async body => {
    expect((await put(body)).status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('PUT stores the pricing and drops the cache', async () => {
    const res = await put(good)
    expect(res.status).toBe(200)
    expect(query.mock.calls[0][0]).toContain('messaging_addon_pricing')
    expect(JSON.parse(query.mock.calls[0][1][0])).toEqual(good)
    expect(addon.invalidateMessagingAddonPricing).toHaveBeenCalledTimes(1)
  })
})

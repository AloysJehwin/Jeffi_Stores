import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const auth = vi.hoisted(() => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const admin = vi.hoisted(() => ({ listAdminDomains: vi.fn() }))
vi.mock('@controller/lib/domains/admin', () => admin)
const pricing = vi.hoisted(() => ({ DEFAULT_DOMAIN_PRICING: { marginPct: 20 }, getDomainPricing: vi.fn(), saveDomainPricing: vi.fn() }))
vi.mock('@controller/lib/domains/pricing', () => pricing)
vi.mock('@controller/lib/domains/providers', () => ({ domainsLive: () => true }))
vi.mock('@controller/lib/compute/catalog', () => ({ getCatalog: async () => ({ settings: { usdInr: 84 } }) }))

import { GET, PUT } from '@controller/app/api/(admin)/admin/ecom/domains/route'

const get = () => GET(new NextRequest('http://localhost/api/admin/ecom/domains'))
const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/admin/ecom/domains', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }))
const good = { marginPct: 25, renewLeadDays: 30, renewCutoffDays: 7, tlds: ['com', 'Co.In', 'com'] }

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireAdminScope.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  admin.listAdminDomains.mockResolvedValue([{ domain: 'a.com' }])
  pricing.getDomainPricing.mockResolvedValue({ marginPct: 25 })
})

describe('/api/admin/ecom/domains', () => {
  it('passes the scope gate response through', async () => {
    auth.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await get()).status).toBe(401)
    expect((await put(good)).status).toBe(401)
    expect(pricing.saveDomainPricing).not.toHaveBeenCalled()
  })

  it('403s a scoped non-administrator', async () => {
    auth.requireAdminScope.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: ['ecom_billing:write'] })
    expect((await get()).status).toBe(403)
    expect((await put(good)).status).toBe(403)
    expect(admin.listAdminDomains).not.toHaveBeenCalled()
  })

  it('GET lists domains with settings and defaults', async () => {
    expect(await (await get()).json()).toEqual({
      domains: [{ domain: 'a.com' }], settings: { marginPct: 25 }, defaults: { marginPct: 20 }, live: true, usdInr: 84,
    })
    expect(auth.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_billing:read')
  })

  it.each([
    [{ ...good, marginPct: 600 }],
    [{ ...good, renewLeadDays: 3 }],
    [{ ...good, tlds: [] }],
    [{ ...good, tlds: ['bad tld!'] }],
    ['not json'],
  ])('PUT 400s for a bad body %#', async body => {
    expect((await put(body)).status).toBe(400)
    expect(pricing.saveDomainPricing).not.toHaveBeenCalled()
  })

  it('PUT 400s when the cut-off is not inside the renewal window', async () => {
    const res = await put({ ...good, renewLeadDays: 10, renewCutoffDays: 10 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('cut-off')
  })

  it('PUT saves de-duplicated, lower-cased TLDs', async () => {
    const res = await put(good)
    expect(res.status).toBe(200)
    expect(pricing.saveDomainPricing).toHaveBeenCalledWith({ marginPct: 25, renewLeadDays: 30, renewCutoffDays: 7, tlds: ['com', 'co.in'] })
    expect(auth.requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'ecom_billing:write')
  })
})

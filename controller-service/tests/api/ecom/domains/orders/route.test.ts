import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockStore, mockSite, mockState, mockView, mockBuy, mockInUse } = vi.hoisted(() => ({
  mockStore: vi.fn(),
  mockSite: vi.fn(),
  mockState: vi.fn(),
  mockView: vi.fn(),
  mockBuy: vi.fn(),
  mockInUse: vi.fn(),
}))

const TID = '11111111-1111-4111-8111-111111111111'
const SID = '22222222-2222-4222-8222-222222222222'

vi.mock('@controller/lib/domains/owner-api', () => ({
  ownerStore: mockStore,
  ownerSite: mockSite,
  ownerDomainsState: mockState,
  ownerOrderView: mockView,
}))
vi.mock('@controller/lib/domains/orders', () => ({ buyDomain: mockBuy }))
vi.mock('@/lib/showcase/domain', () => ({ showcaseDomainInUse: mockInUse }))

import { GET, POST } from '@controller/app/api/(ecom)/ecom/domains/orders/route'

const base = 'https://ecom.jeffistores.in/api/ecom/domains/orders'
const CONTACT = { contactType: 'PERSON', firstName: 'A', lastName: 'B', email: 'a@b.test', phoneNumber: '9876543210', addressLine1: '1 St', city: 'Pune', state: 'MH', zipCode: '411001' }
const post = (body: unknown) => new NextRequest(base, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const BUY = { tenantId: TID, domain: 'acme.in', expectedPriceInr: 799, contact: CONTACT }

describe('/api/ecom/domains/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: TID, service_types: ['store'] } })
    mockView.mockImplementation(async (o: object) => ({ view: o }))
    mockState.mockResolvedValue({ domains: [] })
  })

  it('GET returns the guard response when not signed in', async () => {
    mockStore.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await GET(new NextRequest(`${base}?tenantId=${TID}`))).status).toBe(401)
  })

  it('GET returns the domains state for the store', async () => {
    const res = await GET(new NextRequest(`${base}?tenantId=${TID}`))
    expect(await res.json()).toEqual({ domains: [] })
    expect(mockState).toHaveBeenCalledWith(expect.objectContaining({ id: TID }), { id: 'o-1' }, null)
  })

  it('POST 400s an invalid body and a non-store tenant', async () => {
    expect((await POST(post({ tenantId: 'x' }))).status).toBe(400)
    mockStore.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: TID, service_types: ['messaging'] } })
    expect((await POST(post(BUY))).status).toBe(400)
    expect(mockBuy).not.toHaveBeenCalled()
  })

  it('POST buys the domain and returns the order view', async () => {
    mockBuy.mockResolvedValue({ ok: true, order: { id: 'ord-1' } })
    const res = await POST(post(BUY))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, order: { view: { id: 'ord-1' } } })
    expect(mockBuy).toHaveBeenCalledWith({ tenantId: TID, domain: 'acme.in', contact: expect.objectContaining({ phoneNumber: '+91.9876543210', countryCode: 'IN' }), expectedPriceInr: 799, showcaseSiteId: null })
  })

  it('POST maps a short wallet to 402 and a changed price to 409', async () => {
    mockBuy.mockResolvedValueOnce({ ok: false, code: 'wallet_short', error: 'Top up', shortfallInr: 100 })
    const res = await POST(post(BUY))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ code: 'wallet_short', shortfallInr: 100 })
    mockBuy.mockResolvedValueOnce({ ok: false, code: 'price_changed', error: 'Price moved', priceInr: 899 })
    expect((await POST(post(BUY))).status).toBe(409)
  })

  it('POST for a showcase site 409s when it already has a domain', async () => {
    mockSite.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: TID, service_types: [] } })
    mockInUse.mockResolvedValue('acme.com')
    const res = await POST(post({ ...BUY, siteId: SID }))
    expect(res.status).toBe(409)
    expect(mockSite).toHaveBeenCalledWith(expect.anything(), SID)
    expect(mockBuy).not.toHaveBeenCalled()
  })
})

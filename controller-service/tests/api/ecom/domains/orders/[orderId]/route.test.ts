import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockStore, mockView, mockGet, mockAdvance, mockCancel, mockAutoRenew, mockCurrentRenewal, mockAdvanceRenewal, mockShowcase } = vi.hoisted(() => ({
  mockStore: vi.fn(),
  mockView: vi.fn(),
  mockGet: vi.fn(),
  mockAdvance: vi.fn(),
  mockCancel: vi.fn(),
  mockAutoRenew: vi.fn(),
  mockCurrentRenewal: vi.fn(),
  mockAdvanceRenewal: vi.fn(),
  mockShowcase: vi.fn(),
}))

const OID = '33333333-3333-4333-8333-333333333333'

vi.mock('@controller/lib/domains/owner-api', () => ({ ownerStore: mockStore, ownerOrderView: mockView }))
vi.mock('@controller/lib/domains/orders', () => ({ advanceOrder: mockAdvance, cancelOrder: mockCancel, getOrder: mockGet, setOrderAutoRenew: mockAutoRenew }))
vi.mock('@controller/lib/domains/renewal', () => ({ advanceRenewal: mockAdvanceRenewal, currentRenewal: mockCurrentRenewal }))
vi.mock('@/lib/showcase/store', () => ({ getOwnedShowcase: mockShowcase }))

import { POST } from '@controller/app/api/(ecom)/ecom/domains/orders/[orderId]/route'

const call = (body: unknown, id = OID) =>
  POST(new NextRequest(`https://ecom.jeffistores.in/api/ecom/domains/orders/${id}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { params: Promise.resolve({ orderId: id }) })

describe('POST /api/ecom/domains/orders/[orderId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ id: OID, tenant_id: 't-1', status: 'requested', showcase_site_id: null, expires_at: null })
    mockStore.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' } })
    mockView.mockImplementation(async (o: { status: string }) => ({ status: o.status }))
  })

  it('400s an unknown action and 404s an unknown order', async () => {
    expect((await call({ action: 'explode' })).status).toBe(400)
    expect((await call({ action: 'check' }, 'not-a-uuid')).status).toBe(404)
    mockGet.mockResolvedValue(null)
    expect((await call({ action: 'check' })).status).toBe(404)
  })

  it('returns the owner guard response for a foreign order', async () => {
    mockStore.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await call({ action: 'check' })).status).toBe(401)
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('buy forces the order forward and returns the view', async () => {
    mockAdvance.mockResolvedValue({ id: OID, status: 'registering', last_error: null })
    const res = await call({ action: 'buy' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, order: { status: 'registering' } })
    expect(mockAdvance).toHaveBeenCalledWith(OID, { force: true })
  })

  it('buy answers 402 with the wallet error and 409 once already bought', async () => {
    mockAdvance.mockResolvedValue({ id: OID, status: 'requested', last_error: 'wallet balance too low' })
    const res = await call({ action: 'buy' })
    expect(res.status).toBe(402)
    expect((await res.json()).error).toBe('wallet balance too low')
    mockGet.mockResolvedValue({ id: OID, tenant_id: 't-1', status: 'active' })
    expect((await call({ action: 'buy' })).status).toBe(409)
  })

  it('cancel only works on a requested order', async () => {
    mockCancel.mockResolvedValue({ id: OID, status: 'cancelled' })
    expect((await call({ action: 'cancel' })).status).toBe(200)
    expect(mockCancel).toHaveBeenCalledWith(OID)
    mockGet.mockResolvedValue({ id: OID, tenant_id: 't-1', status: 'active' })
    expect((await call({ action: 'cancel' })).status).toBe(409)
  })

  it('renew 409s with nothing due and 402 with a wallet top-up message', async () => {
    mockGet.mockResolvedValue({ id: OID, tenant_id: 't-1', status: 'active', expires_at: 'E' })
    mockCurrentRenewal.mockResolvedValueOnce(null)
    expect((await call({ action: 'renew' })).status).toBe(409)
    mockCurrentRenewal.mockResolvedValueOnce({ id: 'r-1', term_expires_at: 'E', status: 'due' })
    mockAdvanceRenewal.mockResolvedValue({ status: 'due', last_error: 'wallet balance too low', price_inr: 1200 })
    const res = await call({ action: 'renew' })
    expect(res.status).toBe(402)
    expect((await res.json()).error).toContain('1,200')
    expect(mockAdvanceRenewal).toHaveBeenCalledWith('r-1', { force: true })
  })

  it('auto_renew toggles on a live domain only', async () => {
    mockGet.mockResolvedValue({ id: OID, tenant_id: 't-1', status: 'active' })
    mockAutoRenew.mockResolvedValue({ id: OID, status: 'active' })
    expect((await call({ action: 'auto_renew', on: true })).status).toBe(200)
    expect(mockAutoRenew).toHaveBeenCalledWith(OID, true)
    mockGet.mockResolvedValue({ id: OID, tenant_id: 't-1', status: 'requested' })
    expect((await call({ action: 'auto_renew', on: false })).status).toBe(409)
  })

  it('404s a showcase order the owner does not own', async () => {
    mockGet.mockResolvedValue({ id: OID, tenant_id: 't-1', status: 'requested', showcase_site_id: 's-1' })
    mockShowcase.mockResolvedValue(null)
    expect((await call({ action: 'check' })).status).toBe(404)
    expect(mockShowcase).toHaveBeenCalledWith('s-1', 'o-1')
  })
})

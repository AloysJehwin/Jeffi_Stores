import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ ownerApi: vi.fn(), cancel: vi.fn() }))
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: m.ownerApi }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiCancel: m.cancel }))

import { POST } from '@controller/app/api/(ecom)/ecom/wallet/topup/upi/[intentId]/cancel/route'

const req = () => new NextRequest('https://ecom.test/api/ecom/wallet/topup/upi/i-1/cancel', { method: 'POST' })
const params = { params: Promise.resolve({ intentId: 'i-1' }) }

describe('POST ecom wallet topup upi cancel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes through the auth rejection', async () => {
    m.ownerApi.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await POST(req(), params)).status).toBe(401)
    expect(m.cancel).not.toHaveBeenCalled()
  })

  it('cancels the intent as the owner across their tenants', async () => {
    const tenant = { id: 't-1' }
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant, tenants: [tenant, { id: 't-2' }] })
    m.cancel.mockResolvedValue(NextResponse.json({ status: 'cancelled' }))
    const res = await POST(req(), params)
    expect(await res.json()).toEqual({ status: 'cancelled' })
    expect(m.cancel).toHaveBeenCalledWith('i-1', { kind: 'owner', ownerId: 'o-1', tenant, tenantIds: ['t-1', 't-2'] })
  })

  it('404s an intent that is not theirs', async () => {
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' }, tenants: [{ id: 't-1' }] })
    m.cancel.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    expect((await POST(req(), params)).status).toBe(404)
  })
})

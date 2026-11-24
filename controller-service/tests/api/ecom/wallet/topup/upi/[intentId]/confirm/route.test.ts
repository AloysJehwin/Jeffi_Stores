import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ ownerApi: vi.fn(), confirm: vi.fn() }))
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: m.ownerApi }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiConfirm: m.confirm }))

import { POST } from '@controller/app/api/(ecom)/ecom/wallet/topup/upi/[intentId]/confirm/route'

const req = () => new NextRequest('https://ecom.test/api/ecom/wallet/topup/upi/i-1/confirm', { method: 'POST', body: JSON.stringify({ utr: '123456789012' }) })
const params = { params: Promise.resolve({ intentId: 'i-1' }) }

describe('POST ecom wallet topup upi confirm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes through the auth rejection', async () => {
    m.ownerApi.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await POST(req(), params)).status).toBe(401)
    expect(m.confirm).not.toHaveBeenCalled()
  })

  it('confirms the intent as the owner across their tenants', async () => {
    const tenant = { id: 't-1' }
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant, tenants: [tenant] })
    m.confirm.mockResolvedValue(NextResponse.json({ status: 'submitted' }))
    const r = req()
    const res = await POST(r, params)
    expect(await res.json()).toEqual({ status: 'submitted' })
    expect(m.confirm).toHaveBeenCalledWith(r, 'i-1', { kind: 'owner', ownerId: 'o-1', tenant, tenantIds: ['t-1'] })
  })

  it('surfaces a handler rejection', async () => {
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' }, tenants: [{ id: 't-1' }] })
    m.confirm.mockResolvedValue(NextResponse.json({ error: 'Invalid UTR' }, { status: 400 }))
    expect((await POST(req(), params)).status).toBe(400)
  })
})

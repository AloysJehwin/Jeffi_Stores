import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ ownerApi: vi.fn(), check: vi.fn() }))
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: m.ownerApi }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiCheck: m.check }))

import { POST } from '@controller/app/api/(ecom)/ecom/wallet/topup/upi/[intentId]/check/route'

const req = () => new NextRequest('https://ecom.test/api/ecom/wallet/topup/upi/i-1/check', { method: 'POST' })
const params = { params: Promise.resolve({ intentId: 'i-1' }) }

describe('POST ecom wallet topup upi check', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes through the auth rejection', async () => {
    m.ownerApi.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await POST(req(), params)).status).toBe(401)
    expect(m.check).not.toHaveBeenCalled()
  })

  it('checks the intent as the owner across their tenants', async () => {
    const tenant = { id: 't-1' }
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant, tenants: [tenant] })
    m.check.mockResolvedValue(NextResponse.json({ status: 'pending' }))
    const res = await POST(req(), params)
    expect(await res.json()).toEqual({ status: 'pending' })
    expect(m.check).toHaveBeenCalledWith('i-1', { kind: 'owner', ownerId: 'o-1', tenant, tenantIds: ['t-1'] })
  })

  it('surfaces a handler failure', async () => {
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' }, tenants: [{ id: 't-1' }] })
    m.check.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    expect((await POST(req(), params)).status).toBe(404)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ ownerApi: vi.fn(), start: vi.fn() }))
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: m.ownerApi }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiStart: m.start }))

import { POST } from '@controller/app/api/(ecom)/ecom/wallet/topup/upi/start/route'

const req = () => new NextRequest('https://ecom.test/api/ecom/wallet/topup/upi/start', { method: 'POST', body: '{}' })

describe('POST ecom wallet topup upi start', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes through the auth rejection', async () => {
    m.ownerApi.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await POST(req())).status).toBe(401)
    expect(m.start).not.toHaveBeenCalled()
  })

  it('delegates to the UPI start handler with the owner actor', async () => {
    const tenant = { id: 't-1' }
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant })
    m.start.mockResolvedValue(NextResponse.json({ intentId: 'i-1' }, { status: 201 }))
    const r = req()
    const res = await POST(r)
    expect(res.status).toBe(201)
    expect(m.start).toHaveBeenCalledWith(r, { kind: 'owner', ownerId: 'o-1', tenant }, { returnPrefix: '/ecom' })
  })

  it('surfaces a handler failure', async () => {
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' } })
    m.start.mockResolvedValue(NextResponse.json({ error: 'UPI not configured' }, { status: 409 }))
    expect((await POST(req())).status).toBe(409)
  })
})

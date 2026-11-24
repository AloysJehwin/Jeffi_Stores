import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ ownerApi: vi.fn(), status: vi.fn(), start: vi.fn() }))
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: m.ownerApi }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiStatus: m.status }))
vi.mock('@controller/lib/provisioning/start-store', () => ({ startStoreIfReady: m.start }))

import { GET } from '@controller/app/api/(ecom)/ecom/wallet/topup/upi/[intentId]/route'

const req = () => new NextRequest('https://ecom.test/api/ecom/wallet/topup/upi/i-1')
const params = { params: Promise.resolve({ intentId: 'i-1' }) }

describe('GET ecom wallet topup upi status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.start.mockResolvedValue(true)
  })

  it('passes through the auth rejection', async () => {
    m.ownerApi.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await GET(req(), params)).status).toBe(401)
    expect(m.status).not.toHaveBeenCalled()
  })

  it('reads the status as the owner and starts a waiting store on completion', async () => {
    const tenant = { id: 't-1' }
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant, tenants: [tenant] })
    m.status.mockResolvedValue(NextResponse.json({ status: 'completed' }))
    const res = await GET(req(), params)
    expect(await res.json()).toEqual({ status: 'completed' })
    const [id, actor, opts] = m.status.mock.calls[0]
    expect(id).toBe('i-1')
    expect(actor).toEqual({ kind: 'owner', ownerId: 'o-1', tenant, tenantIds: ['t-1'] })
    expect(await opts.onCompleted({ tenant_id: 't-9' })).toBe(true)
    expect(m.start).toHaveBeenCalledWith('t-9')
    expect(await opts.onCompleted({ tenant_id: null })).toBe(false)
  })

  it('404s an unknown intent', async () => {
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' }, tenants: [{ id: 't-1' }] })
    m.status.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    expect((await GET(req(), params)).status).toBe(404)
  })
})

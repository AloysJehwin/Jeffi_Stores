import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockOwnerApi, mockAdd, mockApprovals, mockRequest, mockQuery, mockEmail, mockGate } = vi.hoisted(() => ({
  mockOwnerApi: vi.fn(),
  mockAdd: vi.fn(),
  mockApprovals: vi.fn(),
  mockRequest: vi.fn(),
  mockQuery: vi.fn(),
  mockEmail: vi.fn(),
  mockGate: vi.fn(),
}))

vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: mockOwnerApi }))
vi.mock('@/lib/tenant-registry', () => ({
  addTenantServices: mockAdd,
  controlPlanePool: () => ({ query: mockQuery }),
  listServiceApprovals: mockApprovals,
  requestServiceApproval: mockRequest,
}))
vi.mock('@/lib/shared/ecom-emails', () => ({ sendServicesRequestedEmail: mockEmail }))
vi.mock('@controller/lib/kyb/gate', () => ({ kybGate: mockGate }))

import { POST } from '@controller/app/api/(ecom)/ecom/services/add/route'

const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/services/add', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const ctx = (service_types: string[]) => ({
  owner: { id: 'o-1', email: 'o@acme.test', name: 'Olu' },
  tenant: { id: 't-1', display_name: 'Acme', service_types },
})

describe('POST /api/ecom/services/add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwnerApi.mockResolvedValue(ctx(['store']))
    mockApprovals.mockResolvedValue([])
    mockGate.mockResolvedValue({ ok: true })
    mockEmail.mockResolvedValue(undefined)
  })

  it('returns the owner-api rejection as is', async () => {
    mockOwnerApi.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await POST(req({ services: ['messaging'] }))).status).toBe(401)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('400s an empty or unknown service list', async () => {
    expect((await POST(req({ services: [] }))).status).toBe(400)
    expect((await POST(req({ services: ['store'] }))).status).toBe(400)
  })

  it('does nothing when the services are already active and not rejected', async () => {
    mockOwnerApi.mockResolvedValue(ctx(['store', 'messaging']))
    const res = await POST(req({ services: ['messaging'] }))
    expect(await res.json()).toEqual({ ok: true })
    expect(mockGate).not.toHaveBeenCalled()
  })

  it('409s kyb_required with what is missing and adds nothing', async () => {
    mockGate.mockResolvedValue({ ok: false, message: 'Finish KYB', missing: ['pan_card'] })
    const res = await POST(req({ services: ['messaging'] }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Finish KYB', code: 'kyb_required', missing: ['pan_card'] })
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('adds the service, requests approval, holds messages for review and emails the owner', async () => {
    const res = await POST(req({ services: ['messaging', 'documents'] }))
    expect(await res.json()).toEqual({ ok: true, pending: ['messaging', 'documents'] })
    expect(mockGate).toHaveBeenCalledWith(expect.objectContaining({ id: 't-1' }), 'o-1', ['messaging', 'documents'])
    expect(mockAdd).toHaveBeenCalledWith('t-1', ['messaging', 'documents'])
    expect(mockRequest).toHaveBeenCalledWith('t-1', ['messaging', 'documents'])
    expect(mockQuery.mock.calls[0][0]).toContain('messaging_tenant_settings')
    expect(mockQuery.mock.calls[0][1]).toEqual(['t-1'])
    expect(mockEmail).toHaveBeenCalledWith({ email: 'o@acme.test', name: 'Olu' }, 'Acme', ['messaging', 'documents'])
  })

  it('re-requests a rejected service without adding it again, and survives an email failure', async () => {
    mockOwnerApi.mockResolvedValue(ctx(['store', 'documents']))
    mockApprovals.mockResolvedValue([{ service: 'documents', status: 'rejected' }])
    mockEmail.mockRejectedValue(new Error('smtp'))
    const res = await POST(req({ services: ['documents'] }))
    expect(await res.json()).toEqual({ ok: true, pending: ['documents'] })
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockRequest).toHaveBeenCalledWith('t-1', ['documents'])
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

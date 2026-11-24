import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockOwnerApi, mockQuery } = vi.hoisted(() => ({ mockOwnerApi: vi.fn(), mockQuery: vi.fn() }))

vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: mockOwnerApi }))
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query: mockQuery }) }))

import { DELETE } from '@controller/app/api/(ecom)/ecom/api-keys/[id]/route'

const call = () =>
  DELETE(new NextRequest('https://ecom.jeffistores.in/api/ecom/api-keys/k-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'k-1' }) })

describe('DELETE /api/ecom/api-keys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwnerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' }, tenants: [] })
  })

  it('rejects an unauthenticated caller', async () => {
    mockOwnerApi.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await call()).status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('revokes an active key scoped to the tenant', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockQuery.mock.calls[0][0]).toContain("status='revoked'")
    expect(mockQuery.mock.calls[0][1]).toEqual(['k-1', 't-1'])
  })

  it('404s a foreign or already revoked key', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 })
    expect((await call()).status).toBe(404)
  })
})

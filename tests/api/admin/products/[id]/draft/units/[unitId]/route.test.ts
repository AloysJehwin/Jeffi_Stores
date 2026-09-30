import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  withTransaction: vi.fn(),
}))

import { authenticateAdmin } from '@/lib/auth/jwt'
import { PATCH, DELETE } from '@/app/api/(admin)/admin/products/[id]/draft/units/[unitId]/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }

function req(method: string, body?: unknown, variantId?: string) {
  const url = new URL('http://localhost/test')
  if (variantId) url.searchParams.set('variant_id', variantId)
  return new NextRequest(url.toString(), {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = Promise.resolve({ id: 'prod-1', unitId: 'u-1' })

describe('products draft units/[unitId] route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('PATCH updates unit in draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ units: [{ id: 'u-1', unit: 'pc', is_base: true }] })
    mockQuery.mockResolvedValueOnce({})
    const res = await PATCH(req('PATCH', { unit: 'dozen', factor: 12 }), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('PATCH adds unit when not found in draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ units: [] })
    mockQuery.mockResolvedValueOnce({})
    const res = await PATCH(req('PATCH', { unit: 'pc', factor: 1 }), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('DELETE removes unit and stores cleared sentinel', async () => {
    mockQueryOne.mockResolvedValueOnce({ units: [{ id: 'u-1', variant_id: null }] })
    mockQuery.mockResolvedValueOnce({})
    const res = await DELETE(req('DELETE'), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('DELETE stores cleared sentinel with variant scope', async () => {
    mockQueryOne.mockResolvedValueOnce({ units: [] })
    mockQuery.mockResolvedValueOnce({})
    const res = await DELETE(req('DELETE', undefined, 'v-1'), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PATCH(req('PATCH', {}), { params })
    expect(res.status).toBe(401)
  })
})

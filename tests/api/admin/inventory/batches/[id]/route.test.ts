import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shelf', () => ({ syncPerishableStock: vi.fn().mockResolvedValue(undefined) }))

import { DELETE } from '@/app/api/admin/inventory/batches/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['inventory'] }
const params = Promise.resolve({ id: 'batch-1' })
const BATCH = { id: 'batch-1', product_id: 'p1', variant_id: null, sub_variant_id: null, quantity_remaining: '10' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryOne).mockResolvedValue(BATCH as any)
  vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [] }) })
  )
})

describe('DELETE /api/admin/inventory/batches/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await DELETE(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await DELETE(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when batch not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await DELETE(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(404)
  })

  it('deletes batch and returns success', async () => {
    const res = await DELETE(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(withTransaction).mockRejectedValue(new Error('db fail'))
    const res = await DELETE(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(500)
  })
})

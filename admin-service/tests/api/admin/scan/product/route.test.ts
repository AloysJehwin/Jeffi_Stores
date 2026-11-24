import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/scan/product/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const call = (qs: string) => GET(new NextRequest(`http://localhost/x${qs}`))

describe('GET /api/admin/scan/product', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockReset()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call('?pid=x')).status).toBe(401)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns 404 with a null product when nothing is given or found', async () => {
    const res = await call('')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ product: null })
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('resolves a variant id first', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ product_id: 'p1', variant_id: 'v1' })
    const res = await call('?vid=%20v1%20&pid=p1')
    expect(await res.json()).toEqual({ product: { product_id: 'p1', variant_id: 'v1' } })
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['v1'])
    expect(queryOne).toHaveBeenCalledTimes(1)
  })

  it('falls back from variant to product id to sku', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ product_id: 'p9' })
    const res = await call('?vid=v1&pid=p1&sku=S-1')
    expect(await res.json()).toEqual({ product: { product_id: 'p9' } })
    expect(vi.mocked(queryOne).mock.calls.map(c => c[1])).toEqual([['v1'], ['p1'], ['S-1']])
  })

  it('returns 500 when the lookup fails', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('db'))
    const res = await call('?pid=p1')
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db')
  })
})

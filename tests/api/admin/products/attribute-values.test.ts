import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { GET as productsGET } from '@/app/api/admin/products/attribute-values/route'
import { GET as controlsGET } from '@/app/api/admin/controls/attribute-values/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['products:read', 'controls:read'] }
const get = (path: string, qs: string) => new NextRequest(`http://localhost${path}?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryMany).mockResolvedValue([{ value: '12.9', count: 159 }] as any)
})

describe('GET /api/admin/products/attribute-values', () => {
  const path = '/api/admin/products/attribute-values'

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await productsGET(get(path, 'field=grade'))).status).toBe(401)
  })

  it('returns 400 for a field it does not know', async () => {
    const res = await productsGET(get(path, 'field=cost_price'))
    expect(res.status).toBe(400)
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('lists values for a column and for a technical spec key', async () => {
    const res = await productsGET(get(path, 'field=grade&search=12'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ field: 'grade', values: [{ value: '12.9', count: 159 }] })

    const spec = await productsGET(get(path, 'field=spec.thread_type&page=3'))
    expect(spec.status).toBe(200)
    const params = vi.mocked(queryMany).mock.calls[1][1] as unknown[]
    expect(params).toEqual(['thread type', 100])
  })
})

describe('GET /api/admin/controls/attribute-values', () => {
  const path = '/api/admin/controls/attribute-values'

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await controlsGET(get(path, 'field=grade'))).status).toBe(401)
  })

  it('returns 403 without controls access', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await controlsGET(get(path, 'field=grade'))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ADMIN.scopes, 'controls:read')
  })

  it('lists values for Controls users', async () => {
    const res = await controlsGET(get(path, 'field=material'))
    expect(res.status).toBe(200)
    expect((await res.json()).values).toHaveLength(1)
  })
})

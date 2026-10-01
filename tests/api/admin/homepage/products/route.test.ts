import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { GET } from '@/app/api/(admin)/admin/homepage/products/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const req = (qs: string) => new NextRequest(`http://localhost/api/admin/homepage/products?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: ['settings:write'] } as any)
  vi.mocked(hasScope).mockReturnValue(true)
})

describe('GET /api/admin/homepage/products', () => {
  it('requires a signed-in admin with settings:write', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await GET(req('q=drill'))).status).toBe(401)
    vi.mocked(hasScope).mockReturnValueOnce(false)
    expect((await GET(req('q=drill'))).status).toBe(403)
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('resolves saved picks in the saved order', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: A, name: 'A' },
      { id: B, name: 'B' },
    ] as any)
    const body = await (await GET(req(`ids=${B},${A}`))).json()
    expect(body.products.map((p: { id: string }) => p.id)).toEqual([B, A])
  })

  it('does not search for fewer than two characters', async () => {
    expect(await (await GET(req('q=d'))).json()).toEqual({ products: [] })
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('searches active products and escapes LIKE wildcards', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    await GET(req(`q=${encodeURIComponent('10%_off')}`))
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(sql).toContain('p.is_active = true')
    expect(params).toEqual(['%10\\%\\_off%', '10\\%\\_off%'])
  })

  it('rejects malformed ids', async () => {
    expect((await GET(req('ids=nope'))).status).toBe(400)
  })
})

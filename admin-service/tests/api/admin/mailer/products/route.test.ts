import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ storeBaseUrlAsync: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/mailer/products/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'

const req = (qs: string) => new NextRequest(`http://localhost/api/admin/mailer/products${qs}`)

describe('GET mailer/products', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockImplementation(((_r: string, _s: string[], scope: string) => scope === 'campaigns:write') as any)
    vi.mocked(storeBaseUrlAsync).mockResolvedValue('https://shop.in/')
    vi.mocked(queryMany).mockResolvedValue([{ name: 'Shirt', slug: 'shirt', price: '1299.5', mrp: null, image: 'i.jpg' }] as any)
  })

  it('401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('?q=shirt'))).status).toBe(401)
  })

  it('403s without any of mailer, campaigns or templates write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req('?q=shirt'))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('manager', [], 'mailer:write')
    expect(hasScope).toHaveBeenCalledWith('manager', [], 'templates:write')
  })

  it('returns nothing for a short query', async () => {
    expect(await (await GET(req('?q=a'))).json()).toEqual({ items: [] })
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns product tiles with absolute urls and formatted prices', async () => {
    const j = await (await GET(req('?q=shirt'))).json()
    expect(j.items).toEqual([{ name: 'Shirt', url: 'https://shop.in/products/shirt', image: 'i.jpg', price: '1,299.5', mrp: null }])
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['%shirt%'])
  })

  it('propagates a query failure', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db'))
    await expect(GET(req('?q=shirt'))).rejects.toThrow('db')
  })
})

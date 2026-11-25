import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/mailer/link-targets/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany } from '@/lib/shared/db'

const req = (qs: string) => new NextRequest(`http://localhost/api/admin/mailer/link-targets${qs}`)

describe('GET mailer/link-targets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(queryMany).mockResolvedValue([{ kind: 'Product', label: 'Shirt', path: '/products/shirt', image_url: null }] as any)
  })

  it('relays a scope rejection (mailer:read)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req('?q=shirt'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'mailer:read')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns nothing for a query under two characters', async () => {
    expect(await (await GET(req('?q=s'))).json()).toEqual({ items: [] })
    expect(await (await GET(req(''))).json()).toEqual({ items: [] })
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('searches with LIKE metacharacters escaped', async () => {
    const j = await (await GET(req('?q=' + encodeURIComponent('50%_off')))).json()
    expect(j.items).toHaveLength(1)
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['%50\\%\\_off%'])
  })

  it('propagates a query failure', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db'))
    await expect(GET(req('?q=shirt'))).rejects.toThrow('db')
  })
})

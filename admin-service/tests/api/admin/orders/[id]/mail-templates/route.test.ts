import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/orders/customer-mail', () => ({ orderMailTemplates: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/orders/[id]/mail-templates/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { orderMailTemplates } from '@/lib/orders/customer-mail'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = () => GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ id: 'o1' }) })

describe('GET /api/admin/orders/[id]/mail-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 403 without orders:read', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', [], 'orders:read')
  })

  it('returns 404 for an unknown order', async () => {
    vi.mocked(orderMailTemplates).mockResolvedValue(null as never)
    expect((await call()).status).toBe(404)
  })

  it('returns the templates for the order', async () => {
    vi.mocked(orderMailTemplates).mockResolvedValue({ templates: [{ id: 't1' }] } as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ templates: [{ id: 't1' }] })
    expect(orderMailTemplates).toHaveBeenCalledWith('o1')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/messaging/library', () => ({ listPageTemplates: vi.fn() }))
vi.mock('@/lib/messaging/placements', () => ({ pageTag: vi.fn((p: string) => `page:${p}`) }))

import { GET } from '@admin/app/api/(admin)/admin/customers/mail-templates/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listPageTemplates } from '@/lib/messaging/library'

const req = () => new NextRequest('http://localhost/api/admin/customers/mail-templates')

describe('GET /api/admin/customers/mail-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401s and 403s', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req())).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'customers:read')
    expect(listPageTemplates).not.toHaveBeenCalled()
  })

  it('returns only the public template fields for the customer page', async () => {
    vi.mocked(listPageTemplates).mockResolvedValue([{ slug: 's', name: 'N', subject: 'S', preheader: 'P', body: 'B', layout: 'L', secret: 'x' }] as any)
    const j = await (await GET(req())).json()
    expect(listPageTemplates).toHaveBeenCalledWith('page:customer')
    expect(j).toEqual({ templates: [{ slug: 's', name: 'N', subject: 'S', preheader: 'P', body: 'B', layout: 'L' }] })
  })

  it('returns an empty list when the lookup fails', async () => {
    vi.mocked(listPageTemplates).mockRejectedValue(new Error('db'))
    expect(await (await GET(req())).json()).toEqual({ templates: [] })
  })
})

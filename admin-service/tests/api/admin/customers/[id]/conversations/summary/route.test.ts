import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/customer-conversations', () => ({ conversationSummary: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/customers/[id]/conversations/summary/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { conversationSummary } from '@/lib/shared/customer-conversations'

const ctx = { params: Promise.resolve({ id: 'u1' }) }
const req = () => new NextRequest('http://localhost/api/admin/customers/u1/conversations/summary')

describe('GET customers/[id]/conversations/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(conversationSummary).mockResolvedValue({ total: 2 } as any)
  })

  it('401s and 403s', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req(), ctx)).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req(), ctx)).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'customers:read')
    expect(conversationSummary).not.toHaveBeenCalled()
  })

  it('summarises by the users email and phone', async () => {
    vi.mocked(queryOne).mockResolvedValue({ email: 'c@x.in', phone: '999' })
    expect(await (await GET(req(), ctx)).json()).toEqual({ total: 2 })
    expect(conversationSummary).toHaveBeenCalledWith('u1', 'c@x.in', '999')
  })

  it('still summarises when the user row is missing', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    await GET(req(), ctx)
    expect(conversationSummary).toHaveBeenCalledWith('u1', undefined, undefined)
  })

  it('propagates a failure', async () => {
    vi.mocked(conversationSummary).mockRejectedValue(new Error('db'))
    await expect(GET(req(), ctx)).rejects.toThrow('db')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/orders/ask-unavailable', () => ({ askAboutUnavailableItem: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/orders/[id]/items/[itemId]/ask-unavailable/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { askAboutUnavailableItem } from '@/lib/orders/ask-unavailable'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = () =>
  POST(new NextRequest('http://localhost/x', { method: 'POST' }), {
    params: Promise.resolve({ id: 'o1', itemId: 'i1' }),
  })

describe('POST /api/admin/orders/[id]/items/[itemId]/ask-unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 403 without orders:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(askAboutUnavailableItem).not.toHaveBeenCalled()
  })

  it('relays the helper failure status', async () => {
    vi.mocked(askAboutUnavailableItem).mockResolvedValue({ ok: false, error: 'No such item', status: 404 } as never)
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No such item' })
  })

  it('asks the customer and returns the channels used', async () => {
    vi.mocked(askAboutUnavailableItem).mockResolvedValue({ ok: true, channels: ['email'] } as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, channels: ['email'] })
    expect(askAboutUnavailableItem).toHaveBeenCalledWith('o1', 'i1')
  })
})

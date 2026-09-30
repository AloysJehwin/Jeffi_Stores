import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))

import { POST } from '@/app/api/admin/campaigns/[kind]/run/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['mailer'] }
const params = Promise.resolve({ kind: 'welcome' })

function makeRequest(kind = 'welcome') {
  return new NextRequest(`http://localhost/api/admin/campaigns/${kind}/run`, { method: 'POST' })
}

describe('POST /api/admin/campaigns/[kind]/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'test-cron-secret')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 500 when CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '')
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/CRON_SECRET/i)
  })

  it('proxies cron endpoint and returns its response', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ sent: 5 }),
      status: 200,
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(5)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/cron/run-campaigns?kind=welcome'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer') }),
      })
    )
  })

  it('returns 500 when fetch throws', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('network error')
  })

  it('passes kind to cron URL', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({}),
      status: 200,
    })
    vi.stubGlobal('fetch', mockFetch)

    await POST(makeRequest('reorder'), { params: Promise.resolve({ kind: 'reorder' }) })
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('kind=reorder'), expect.any(Object))
  })
})

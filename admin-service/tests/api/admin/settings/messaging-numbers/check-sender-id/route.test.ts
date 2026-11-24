import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/messaging/audiences', () => ({ PLATFORM_TENANT_ID: 'platform' }))
vi.mock('@/lib/messaging/dlt-sender-check', () => ({ checkSenderId: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/settings/messaging-numbers/check-sender-id/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformAdmin } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { checkSenderId } from '@/lib/messaging/dlt-sender-check'

const get = (header = 'JEFFIS') => GET(new NextRequest(`http://localhost/x?header=${header}`))

describe('GET /api/admin/settings/messaging-numbers/check-sender-id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] })
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveTenantId).mockResolvedValue('platform' as never)
  })

  it('401s unauthenticated; 403s a store admin, a missing settings:write scope and a store tenant, never calling AWS', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] })
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await get()).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await get()).status).toBe(403)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveTenantId).mockResolvedValue('store-1' as never)
    expect((await get()).status).toBe(403)
    expect(checkSenderId).not.toHaveBeenCalled()
  })

  it('returns Registered / Not registered, 400 for a bad header and 502 for an AWS failure', async () => {
    vi.mocked(checkSenderId).mockResolvedValueOnce({ header: 'JEFFIS', registered: false, status: null })
    expect(await (await get()).json()).toEqual({ header: 'JEFFIS', registered: false, status: null })
    vi.mocked(checkSenderId).mockRejectedValueOnce(new Error('The DLT header is 3 to 11 letters or digits'))
    expect((await get('x')).status).toBe(400)
    vi.mocked(checkSenderId).mockRejectedValueOnce(new Error('boom'))
    expect((await get()).status).toBe(502)
  })

  it('treats an unresolvable tenant as the platform', async () => {
    vi.mocked(resolveTenantId).mockRejectedValue(new Error('none'))
    vi.mocked(checkSenderId).mockResolvedValue({ header: 'JEFFIS', registered: true, status: 'TRANSACTIONAL' })
    expect((await get()).status).toBe(200)
  })
})

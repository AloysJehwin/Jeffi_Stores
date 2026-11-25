import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ withPlan: vi.fn() }))
vi.mock('@/lib/setup-guide/status', () => ({ getSetupGuide: vi.fn() }))
vi.mock('@/lib/setup-guide/route', () => ({ setupTenantId: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/setup-guide/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope, isPlatformAdmin } from '@/lib/auth/scopes'
import { withPlan } from '@/lib/channels/route'
import { getSetupGuide } from '@/lib/setup-guide/status'
import { setupTenantId } from '@/lib/setup-guide/route'

const admin = { adminId: 'a1', role: 'admin', scopes: ['setup_guide:read'] }
const call = () => GET(new NextRequest('http://localhost/x'))

describe('GET /api/admin/setup-guide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue(admin as never)
    vi.mocked(withPlan).mockImplementation((async (a: unknown) => a) as never)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    vi.mocked(setupTenantId).mockResolvedValue('t1' as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns the scope failure (needs setup_guide:read)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'setup_guide:read')
    expect(getSetupGuide).not.toHaveBeenCalled()
  })

  it('returns the plan gate failure', async () => {
    vi.mocked(withPlan).mockResolvedValue(NextResponse.json({ error: 'Not on your plan' }, { status: 402 }))
    expect((await call()).status).toBe(402)
    expect(getSetupGuide).not.toHaveBeenCalled()
  })

  it('returns the guide with write and platform flags', async () => {
    vi.mocked(getSetupGuide).mockResolvedValue({ steps: [1] } as never)
    const body = await (await call()).json()
    expect(body).toEqual({ steps: [1], canWrite: true, platform: false })
    expect(getSetupGuide).toHaveBeenCalledWith({ role: 'admin', scopes: ['setup_guide:read'] }, 't1')
  })

  it('marks the platform admin on the flagship (no tenant)', async () => {
    vi.mocked(setupTenantId).mockResolvedValue(null as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    vi.mocked(hasScope).mockReturnValue(false)
    vi.mocked(getSetupGuide).mockResolvedValue({} as never)
    expect(await (await call()).json()).toEqual({ canWrite: false, platform: true })
  })

  it('returns 500 when the guide fails to load', async () => {
    vi.mocked(getSetupGuide).mockRejectedValue(new Error('db'))
    expect((await call()).status).toBe(500)
  })
})

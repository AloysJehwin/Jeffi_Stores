import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@/app/api/(admin)/admin/team/overview/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/team/overview${qs}`)

describe('GET /api/admin/team/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockResolvedValue({ admins: '3', active: '2', mfa: '1', no_mfa: '1' } as any)
  })

  it('needs a signed-in admin', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
  })

  it('is owner-only, like the team page', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: ['settings:read'] } as any)
    expect((await GET(req())).status).toBe(403)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns MFA coverage and flags members without MFA', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'super_admin', scopes: [] } as any)
    const j = await (await GET(req('?from=2026-10-01&to=2026-10-10'))).json()
    expect(j.previous_range).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(j.kpis.find((k: any) => k.key === 'mfa').value).toBe(0.5)
    expect(j.attention[0]).toMatchObject({ key: 'mfa', severity: 'critical' })
  })
})

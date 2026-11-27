import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/catalog', async () => await import('../../../../../lib/outreach/agent/skill-fake-catalog'))

import { GET } from '@controller/app/api/(admin)/admin/ecom/outreach/catalog/route'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const url = 'http://localhost/api/admin/ecom/outreach/catalog'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
})

describe('/api/admin/ecom/outreach/catalog', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await GET(new NextRequest(url))).status).toBe(403)
  })

  it('returns the tools, hard limits, placeholders, channels and flows under the read scope', async () => {
    const j = await (await GET(new NextRequest(url))).json()
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    expect(j.tools.map((t: { name: string }) => t.name)).toContain('startPreview')
    expect(j.tools.find((t: { name: string }) => t.name === 'optOut')).toMatchObject({ mandatory: true })
    expect(j.limits).toEqual(HARD_LIMITS)
    expect(j.placeholders).toEqual(expect.arrayContaining(['business', 'now_ist', 'trial_days']))
    expect(j.channels).toEqual(['voice', 'whatsapp', 'follow_up'])
    expect(j.flows).toEqual(['one_call', 'two_call', 'whatsapp_only'])
  })
})

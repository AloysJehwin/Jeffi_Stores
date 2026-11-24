import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/data', () => ({ listAutopostRules: vi.fn() }))
vi.mock('@/lib/social/library', async (orig) => ({ ...(await orig<any>()), saveRule: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/social/autopost/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { listAutopostRules } from '@/lib/social/data'
import { saveRule } from '@/lib/social/library'

const req = (method: string) => new NextRequest('http://localhost/api/admin/social/autopost', { method })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('GET /api/admin/social/autopost', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req('GET'))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req('GET'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:read')
  })

  it('lists the rules for the tenant', async () => {
    vi.mocked(listAutopostRules).mockResolvedValue([{ id: 'r1' }] as any)
    expect(await (await GET(req('GET'))).json()).toEqual({ rules: [{ id: 'r1' }] })
    expect(listAutopostRules).toHaveBeenCalledWith('t1')
  })
})

describe('POST /api/admin/social/autopost', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req('POST'))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req('POST'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 400 for an invalid rule', async () => {
    vi.mocked(readJson).mockResolvedValue({ trigger: 'nope', platforms: [] })
    expect((await POST(req('POST'))).status).toBe(400)
    expect(saveRule).not.toHaveBeenCalled()
  })

  it('saves the rule with defaults applied', async () => {
    vi.mocked(readJson).mockResolvedValue({ trigger: 'new_product', platforms: ['fb'] })
    vi.mocked(saveRule).mockResolvedValue({ id: 'r1' } as any)
    expect(await (await POST(req('POST'))).json()).toEqual({ rule: { id: 'r1' } })
    expect(saveRule).toHaveBeenCalledWith('t1', expect.objectContaining({ trigger: 'new_product', minDropPct: 10, requireApproval: true, enabled: true }))
  })

  it('propagates a storage failure', async () => {
    vi.mocked(readJson).mockResolvedValue({ trigger: 'new_product', platforms: ['fb'] })
    vi.mocked(saveRule).mockRejectedValue(new Error('db'))
    await expect(POST(req('POST'))).rejects.toThrow('db')
  })
})

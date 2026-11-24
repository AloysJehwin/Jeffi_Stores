import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/library', async (orig) => ({ ...(await orig<any>()), saveRule: vi.fn(), deleteRule: vi.fn() }))

import { PATCH, DELETE } from '@admin/app/api/(admin)/admin/social/autopost/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { saveRule, deleteRule } from '@/lib/social/library'

const req = (method: string) => new NextRequest('http://localhost/api/admin/social/autopost/r1', { method })
const ctx = { params: Promise.resolve({ id: 'r1' }) }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('PATCH /api/admin/social/autopost/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 400 for an invalid rule', async () => {
    vi.mocked(readJson).mockResolvedValue({ platforms: [] })
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(400)
  })

  it('updates the rule', async () => {
    vi.mocked(readJson).mockResolvedValue({ trigger: 'price_drop', platforms: ['x'] })
    vi.mocked(saveRule).mockResolvedValue({ id: 'r1' } as any)
    expect(await (await PATCH(req('PATCH'), ctx)).json()).toEqual({ rule: { id: 'r1' } })
    expect(saveRule).toHaveBeenCalledWith('t1', expect.objectContaining({ trigger: 'price_drop' }), 'r1')
  })

  it('returns 404 when the rule does not exist', async () => {
    vi.mocked(readJson).mockResolvedValue({ trigger: 'price_drop', platforms: ['x'] })
    vi.mocked(saveRule).mockResolvedValue(null as any)
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(404)
  })
})

describe('DELETE /api/admin/social/autopost/[id]', () => {
  it('rejects unauthenticated', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(401)
    expect(deleteRule).not.toHaveBeenCalled()
  })

  it('deletes the rule', async () => {
    vi.mocked(deleteRule).mockResolvedValue(true as any)
    expect(await (await DELETE(req('DELETE'), ctx)).json()).toEqual({ ok: true })
    expect(deleteRule).toHaveBeenCalledWith('t1', 'r1')
  })

  it('returns 404 when nothing was deleted', async () => {
    vi.mocked(deleteRule).mockResolvedValue(false as any)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(404)
  })
})

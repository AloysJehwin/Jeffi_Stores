import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/library', async (orig) => ({ ...(await orig<any>()), saveTemplate: vi.fn(), deleteTemplate: vi.fn() }))

import { PATCH, DELETE } from '@admin/app/api/(admin)/admin/social/templates/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { saveTemplate, deleteTemplate } from '@/lib/social/library'

const req = (method: string) => new NextRequest('http://localhost/api/admin/social/templates/x', { method })
const ctx = { params: Promise.resolve({ id: 'x' }) }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('PATCH /api/admin/social/templates/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 400 for an invalid template', async () => {
    vi.mocked(readJson).mockResolvedValue({ name: 'a' })
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(400)
  })

  it('updates the template', async () => {
    vi.mocked(readJson).mockResolvedValue({ name: 'a', caption: 'b' })
    vi.mocked(saveTemplate).mockResolvedValue({ id: 'x' } as any)
    expect(await (await PATCH(req('PATCH'), ctx)).json()).toEqual({ template: { id: 'x' } })
    expect(saveTemplate).toHaveBeenCalledWith('t1', { name: 'a', caption: 'b' }, 'x')
  })

  it('returns 404 when it does not exist', async () => {
    vi.mocked(readJson).mockResolvedValue({ name: 'a', caption: 'b' })
    vi.mocked(saveTemplate).mockResolvedValue(null as any)
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(404)
  })
})

describe('DELETE /api/admin/social/templates/[id]', () => {
  it('rejects unauthenticated', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(401)
    expect(deleteTemplate).not.toHaveBeenCalled()
  })

  it('deletes the template', async () => {
    vi.mocked(deleteTemplate).mockResolvedValue(true as any)
    expect(await (await DELETE(req('DELETE'), ctx)).json()).toEqual({ ok: true })
    expect(deleteTemplate).toHaveBeenCalledWith('t1', 'x')
  })

  it('returns 404 when nothing was deleted', async () => {
    vi.mocked(deleteTemplate).mockResolvedValue(false as any)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(404)
  })
})

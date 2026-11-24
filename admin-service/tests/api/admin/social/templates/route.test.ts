import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/data', () => ({ listTemplates: vi.fn() }))
vi.mock('@/lib/social/library', async (orig) => ({ ...(await orig<any>()), saveTemplate: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/social/templates/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { listTemplates } from '@/lib/social/data'
import { saveTemplate } from '@/lib/social/library'

const req = (method: string) => new NextRequest('http://localhost/api/admin/social/templates', { method })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('GET /api/admin/social/templates', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req('GET'))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req('GET'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:read')
  })

  it('lists templates for the tenant', async () => {
    vi.mocked(listTemplates).mockResolvedValue([{ id: 'x' }] as any)
    expect(await (await GET(req('GET'))).json()).toEqual({ templates: [{ id: 'x' }] })
    expect(listTemplates).toHaveBeenCalledWith('t1')
  })
})

describe('POST /api/admin/social/templates', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req('POST'))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req('POST'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 400 for an invalid template', async () => {
    vi.mocked(readJson).mockResolvedValue({ name: '', caption: '' })
    expect((await POST(req('POST'))).status).toBe(400)
    expect(saveTemplate).not.toHaveBeenCalled()
  })

  it('saves the template', async () => {
    vi.mocked(readJson).mockResolvedValue({ name: ' Sale ', caption: 'Big sale' })
    vi.mocked(saveTemplate).mockResolvedValue({ id: 'x' } as any)
    expect(await (await POST(req('POST'))).json()).toEqual({ template: { id: 'x' } })
    expect(saveTemplate).toHaveBeenCalledWith('t1', { name: 'Sale', caption: 'Big sale' })
  })

  it('propagates a storage failure', async () => {
    vi.mocked(readJson).mockResolvedValue({ name: 'a', caption: 'b' })
    vi.mocked(saveTemplate).mockRejectedValue(new Error('db'))
    await expect(POST(req('POST'))).rejects.toThrow('db')
  })
})

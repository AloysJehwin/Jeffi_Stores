import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/integrations/owner', () => ({ credentialOwnerId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/catalog/meta', () => ({ listMetaPages: vi.fn() }))
vi.mock('@/lib/social/meta-connect', () => ({ clearPendingPagePick: vi.fn(), readPendingPagePick: vi.fn(), saveMetaPage: vi.fn() }))

import { GET, POST, DELETE } from '@admin/app/api/(admin)/admin/social/meta/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { readJson } from '@/lib/channels/route'
import { listMetaPages } from '@/lib/catalog/meta'
import { clearPendingPagePick, readPendingPagePick, saveMetaPage } from '@/lib/social/meta-connect'

const run = async (fn: (r: NextRequest) => Promise<Response | undefined>, method: string) => (await fn(req(method)))!
const req = (method: string) => new NextRequest('http://localhost/api/admin/social/meta', { method })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const page = { pageId: '12345', pageName: 'Shop', igUserId: '999' }
const pending = { userToken: 'utok', fbUserId: 'f1', granted: [] }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(credentialOwnerId).mockResolvedValue('t1' as any)
})

describe('auth', () => {
  it.each([
    ['GET', GET],
    ['POST', POST],
    ['DELETE', DELETE],
  ] as const)('%s rejects unauthenticated and missing scope', async (m, fn) => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await run(fn, m)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await run(fn, m)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
    expect(readPendingPagePick).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/social/meta', () => {
  it('returns null pages when no sign-in is pending', async () => {
    vi.mocked(readPendingPagePick).mockResolvedValue(null as any)
    expect(await (await run(GET, 'GET')).json()).toEqual({ pages: null })
  })

  it('lists the reachable pages', async () => {
    vi.mocked(readPendingPagePick).mockResolvedValue(pending as any)
    vi.mocked(listMetaPages).mockResolvedValue([page] as any)
    expect(await (await run(GET, 'GET')).json()).toEqual({ pages: [{ id: '12345', name: 'Shop', instagram: true }] })
    expect(listMetaPages).toHaveBeenCalledWith('utok')
  })

  it('returns an empty list with the error when Meta fails', async () => {
    vi.mocked(readPendingPagePick).mockResolvedValue(pending as any)
    vi.mocked(listMetaPages).mockRejectedValue(new Error('token expired'))
    expect(await (await run(GET, 'GET')).json()).toEqual({ pages: [], error: 'token expired' })
  })
})

describe('POST /api/admin/social/meta', () => {
  it('returns 400 for a non-numeric page id', async () => {
    vi.mocked(readJson).mockResolvedValue({ pageId: 'abc' })
    expect((await run(POST, 'POST')).status).toBe(400)
  })

  it('returns 409 when the sign-in expired', async () => {
    vi.mocked(readJson).mockResolvedValue({ pageId: '12345' })
    vi.mocked(readPendingPagePick).mockResolvedValue(null as any)
    expect((await run(POST, 'POST')).status).toBe(409)
    expect(saveMetaPage).not.toHaveBeenCalled()
  })

  it('returns 502 when Meta refuses to list pages', async () => {
    vi.mocked(readJson).mockResolvedValue({ pageId: '12345' })
    vi.mocked(readPendingPagePick).mockResolvedValue(pending as any)
    vi.mocked(listMetaPages).mockRejectedValue(new Error('rate limit'))
    const res = await run(POST, 'POST')
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('rate limit')
  })

  it('returns 400 when the page is not reachable', async () => {
    vi.mocked(readJson).mockResolvedValue({ pageId: '77777' })
    vi.mocked(readPendingPagePick).mockResolvedValue(pending as any)
    vi.mocked(listMetaPages).mockResolvedValue([page] as any)
    expect((await run(POST, 'POST')).status).toBe(400)
    expect(saveMetaPage).not.toHaveBeenCalled()
  })

  it('saves the chosen page and clears the pending pick', async () => {
    vi.mocked(readJson).mockResolvedValue({ pageId: '12345' })
    vi.mocked(readPendingPagePick).mockResolvedValue(pending as any)
    vi.mocked(listMetaPages).mockResolvedValue([page] as any)
    expect(await (await run(POST, 'POST')).json()).toEqual({ ok: true, page_name: 'Shop', instagram: true })
    expect(saveMetaPage).toHaveBeenCalledWith('t1', page, pending)
    expect(clearPendingPagePick).toHaveBeenCalledWith('t1')
  })
})

describe('DELETE /api/admin/social/meta', () => {
  it('clears the pending pick', async () => {
    expect(await (await run(DELETE, 'DELETE')).json()).toEqual({ ok: true })
    expect(clearPendingPagePick).toHaveBeenCalledWith('t1')
  })
})

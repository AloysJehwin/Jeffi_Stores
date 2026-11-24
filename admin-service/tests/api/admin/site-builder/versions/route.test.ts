import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/site/after-publish', () => ({ afterSiteChange: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ listPageVersions: vi.fn(), rollbackPage: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/site-builder/versions/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { afterSiteChange } from '@/lib/site/after-publish'
import { listPageVersions, rollbackPage } from '@/lib/site/store'

const KEY = 'store:web:home:'
const denied = (status: number) => NextResponse.json({ error: 'no' }, { status })
const get = (qs = `?key=${KEY}`) => new NextRequest(`http://localhost/api/admin/site-builder/versions${qs}`)
const post = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/versions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(logAdminAudit).mockResolvedValue(undefined as any)
})

describe('GET /api/admin/site-builder/versions', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await GET(get())).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('returns 400 for an unknown page key', async () => {
    expect((await GET(get('?key=nope'))).status).toBe(400)
    expect((await GET(get(''))).status).toBe(400)
    expect(listPageVersions).not.toHaveBeenCalled()
  })

  it('lists the page versions', async () => {
    vi.mocked(listPageVersions).mockResolvedValue([{ version: 2 }, { version: 1 }] as any)
    expect(await (await GET(get())).json()).toEqual({ versions: [{ version: 2 }, { version: 1 }] })
    expect(listPageVersions).toHaveBeenCalledWith({ audience: 'store', surface: 'web', page: 'home', slug: '' })
  })
})

describe('POST /api/admin/site-builder/versions', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await POST(post({ key: KEY, version: 1 }))).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(rollbackPage).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ key: KEY }], [{ key: KEY, version: 0 }], [{ key: KEY, version: 1.5 }], [{ key: 'bogus', version: 1 }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(post(body))).status).toBe(400)
    expect(rollbackPage).not.toHaveBeenCalled()
  })

  it('returns 404 when the version is not kept', async () => {
    vi.mocked(rollbackPage).mockResolvedValue(null as any)
    expect((await POST(post({ key: KEY, version: 9 }))).status).toBe(404)
    expect(afterSiteChange).not.toHaveBeenCalled()
    expect(logAdminAudit).not.toHaveBeenCalled()
  })

  it('republishes the version, refreshes the site and audits it', async () => {
    vi.mocked(rollbackPage).mockResolvedValue(7 as any)
    const res = await POST(post({ key: KEY, version: 3 }))
    expect(await res.json()).toEqual({ version: 7 })
    expect(rollbackPage).toHaveBeenCalledWith({ audience: 'store', surface: 'web', page: 'home', slug: '' }, 3, 'a1')
    expect(afterSiteChange).toHaveBeenCalled()
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', entityId: KEY, summary: `Rolled ${KEY} back to version 3` }))
  })

  it('treats version 0 from the store as a result, and survives a failing audit write', async () => {
    vi.mocked(rollbackPage).mockResolvedValue(0 as any)
    vi.mocked(logAdminAudit).mockRejectedValue(new Error('audit'))
    expect(await (await POST(post({ key: KEY, version: 1 }))).json()).toEqual({ version: 0 })
  })
})

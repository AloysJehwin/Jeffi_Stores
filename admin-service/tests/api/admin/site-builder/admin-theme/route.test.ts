import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/site/admin-theme', () => ({ adminUsesSiteTheme: vi.fn(), setAdminUsesSiteTheme: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/site-builder/admin-theme/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { adminUsesSiteTheme, setAdminUsesSiteTheme } from '@/lib/site/admin-theme'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: [] }
const denied = (status: number) => NextResponse.json({ error: 'no' }, { status })
const get = () => new NextRequest('http://localhost/api/admin/site-builder/admin-theme')
const post = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/admin-theme', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(logAdminAudit).mockResolvedValue(undefined as any)
  vi.mocked(setAdminUsesSiteTheme).mockResolvedValue(undefined)
})

describe('GET /api/admin/site-builder/admin-theme', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async status => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await GET(get())).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('returns whether the admin uses the site theme', async () => {
    vi.mocked(adminUsesSiteTheme).mockResolvedValue(true)
    const res = await GET(get())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true })
  })
})

describe('POST /api/admin/site-builder/admin-theme', () => {
  it('needs settings:write', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(403) as any)
    expect((await POST(post({ enabled: true }))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(setAdminUsesSiteTheme).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{}], [{ enabled: 'yes' }]])('400s a bad body %j', async body => {
    expect((await POST(post(body))).status).toBe(400)
    expect(setAdminUsesSiteTheme).not.toHaveBeenCalled()
  })

  it.each([[true], [false]])('saves %s, audits it and echoes it back', async enabled => {
    const res = await POST(post({ enabled }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled })
    expect(setAdminUsesSiteTheme).toHaveBeenCalledWith(enabled)
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', entityType: 'site_builder', entityId: 'admin_theme' }))
  })

  it('a failed audit write does not fail the save', async () => {
    vi.mocked(logAdminAudit).mockRejectedValue(new Error('audit down'))
    expect((await POST(post({ enabled: true }))).status).toBe(200)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ createSiteDraft: vi.fn(), listSiteDrafts: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/site-builder/drafts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { createSiteDraft, listSiteDrafts } from '@/lib/site/store'

const denied = (status: number) => NextResponse.json({ error: 'no' }, { status })
const url = 'http://localhost/api/admin/site-builder/drafts'
const post = (body?: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? 'nope' : JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
})

describe('GET /api/admin/site-builder/drafts', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await GET(new NextRequest(url))).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('lists the drafts', async () => {
    vi.mocked(listSiteDrafts).mockResolvedValue([{ id: 'd1' }] as any)
    expect(await (await GET(new NextRequest(url))).json()).toEqual({ drafts: [{ id: 'd1' }] })
  })
})

describe('POST /api/admin/site-builder/drafts', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await POST(post({ title: 'x' }))).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(createSiteDraft).not.toHaveBeenCalled()
  })

  it('returns 400 when the title is too long', async () => {
    expect((await POST(post({ title: 'x'.repeat(121) }))).status).toBe(400)
    expect(createSiteDraft).not.toHaveBeenCalled()
  })

  it('creates a draft for the admin with the title', async () => {
    vi.mocked(createSiteDraft).mockResolvedValue('d9' as any)
    expect(await (await POST(post({ title: 'Diwali' }))).json()).toEqual({ id: 'd9' })
    expect(createSiteDraft).toHaveBeenCalledWith('a1', 'Diwali')
  })

  it('creates an untitled draft when the body is not JSON', async () => {
    vi.mocked(createSiteDraft).mockResolvedValue('d10' as any)
    expect((await POST(post())).status).toBe(200)
    expect(createSiteDraft).toHaveBeenCalledWith('a1', undefined)
  })

  it('lets a failure propagate', async () => {
    vi.mocked(createSiteDraft).mockRejectedValue(new Error('db'))
    await expect(POST(post({}))).rejects.toThrow('db')
  })
})

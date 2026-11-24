import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/site/convert', () => ({ convertBlock: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/site-builder/convert/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { convertBlock } from '@/lib/site/convert'
import { siteEditorEnabled } from '@/lib/site/store'

const BLOCK = { id: 'b1', type: 'hero', props: { title: 'Hi' } }
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(siteEditorEnabled).mockResolvedValue(true)
})

describe('POST /api/admin/site-builder/convert', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await POST(req({ page: 'home', block: BLOCK }))).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(convertBlock).not.toHaveBeenCalled()
  })

  it('returns 404 while the visual editor is off', async () => {
    vi.mocked(siteEditorEnabled).mockResolvedValue(false)
    expect((await POST(req({ page: 'home', block: BLOCK }))).status).toBe(404)
    expect(convertBlock).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ page: 'home' }], [{ page: 'bogus', block: BLOCK }], [{ page: 'home', block: { id: 'b1' } }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(req(body))).status).toBe(400)
    expect(convertBlock).not.toHaveBeenCalled()
  })

  it('returns the converted block, defaulting its version to 1', async () => {
    vi.mocked(convertBlock).mockResolvedValue({ ok: true, block: { id: 'b1', type: 'code_section' } } as any)
    const res = await POST(req({ page: 'home', block: BLOCK }))
    expect(await res.json()).toEqual({ block: { id: 'b1', type: 'code_section' } })
    expect(convertBlock).toHaveBeenCalledWith({ ...BLOCK, v: 1 }, 'home')
  })

  it('keeps the version the block already has', async () => {
    vi.mocked(convertBlock).mockResolvedValue({ ok: true, block: {} } as any)
    await POST(req({ page: 'home', block: { ...BLOCK, v: 3 } }))
    expect(vi.mocked(convertBlock).mock.calls[0][0]).toMatchObject({ v: 3 })
  })

  it('returns 422 for a kind of block that cannot be converted', async () => {
    vi.mocked(convertBlock).mockResolvedValue(null as any)
    expect((await POST(req({ page: 'home', block: BLOCK }))).status).toBe(422)
  })

  it('returns 422 with the first issue when the conversion fails', async () => {
    vi.mocked(convertBlock).mockResolvedValue({ ok: false, issues: [{ message: 'no compile' }] } as any)
    const res = await POST(req({ page: 'home', block: BLOCK }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'no compile' })
  })
})

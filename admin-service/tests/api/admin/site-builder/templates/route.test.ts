import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/site/templates', () => ({ builtInTemplates: vi.fn(), deleteTemplate: vi.fn(), saveTemplate: vi.fn(), savedTemplates: vi.fn() }))
vi.mock('@/lib/site/themes/pages', () => ({ themeAvailability: vi.fn() }))

import { DELETE, GET, POST } from '@admin/app/api/(admin)/admin/site-builder/templates/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { builtInTemplates, deleteTemplate, saveTemplate, savedTemplates } from '@/lib/site/templates'
import { themeAvailability } from '@/lib/site/themes/pages'

const ID = '11111111-1111-4111-8111-111111111111'
const DOC = { blocks: { b1: { id: 'b1', type: 'hero', v: 1, props: {} } }, order: ['b1'] }
const PAGE = { audience: 'store', surface: 'web', page: 'home', doc: DOC }
const denied = (status: number) => NextResponse.json({ error: 'no' }, { status })
const url = 'http://localhost/api/admin/site-builder/templates'
const post = (body?: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? 'nope' : JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
})

describe('GET /api/admin/site-builder/templates', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await GET(new NextRequest(url))).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('lists built-in, saved templates and theme availability', async () => {
    vi.mocked(builtInTemplates).mockReturnValue([{ id: 'b' }] as any)
    vi.mocked(savedTemplates).mockResolvedValue([{ id: 's' }] as any)
    vi.mocked(themeAvailability).mockReturnValue([{ id: 't' }] as any)
    expect(await (await GET(new NextRequest(url))).json()).toEqual({ builtIn: [{ id: 'b' }], saved: [{ id: 's' }], themes: [{ id: 't' }] })
    expect(themeAvailability).toHaveBeenCalledWith('store')
  })
})

describe('POST /api/admin/site-builder/templates', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await POST(post({ name: 'My tpl', pages: [PAGE] }))).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(saveTemplate).not.toHaveBeenCalled()
  })

  it.each([
    [undefined],
    [{ name: 'x', pages: [PAGE] }],
    [{ name: 'My tpl', pages: [] }],
    [{ name: 'My tpl', kind: 'block', pages: [PAGE, PAGE] }],
    [{ name: 'My tpl', kind: 'block', pages: [{ ...PAGE, doc: { ...DOC, order: ['b1', 'b2'] } }] }],
  ])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(post(body))).status).toBe(400)
    expect(saveTemplate).not.toHaveBeenCalled()
  })

  it('saves the template as the admin and returns its id', async () => {
    vi.mocked(saveTemplate).mockResolvedValue(ID)
    const res = await POST(post({ name: '  My tpl  ', description: 'd', pages: [PAGE] }))
    expect(await res.json()).toEqual({ id: ID })
    expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ name: 'My tpl', description: 'd', pages: [expect.objectContaining({ page: 'home' })] }), 'a1')
  })

  it('saves a single-block template', async () => {
    vi.mocked(saveTemplate).mockResolvedValue(ID)
    expect((await POST(post({ name: 'My blk', kind: 'block', pages: [PAGE] }))).status).toBe(200)
  })

  it('lets a save failure propagate', async () => {
    vi.mocked(saveTemplate).mockRejectedValue(new Error('db'))
    await expect(POST(post({ name: 'My tpl', pages: [PAGE] }))).rejects.toThrow('db')
  })
})

describe('DELETE /api/admin/site-builder/templates', () => {
  const del = (qs: string) => new NextRequest(`${url}${qs}`, { method: 'DELETE' })

  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await DELETE(del(`?id=${ID}`))).status).toBe(status)
    expect(deleteTemplate).not.toHaveBeenCalled()
  })

  it.each([[''], ['?id=starter'], ['?id=ZZZ']])('returns 400 for a built-in or malformed id (%s)', async (qs) => {
    expect((await DELETE(del(qs))).status).toBe(400)
    expect(deleteTemplate).not.toHaveBeenCalled()
  })

  it('deletes a saved template', async () => {
    vi.mocked(deleteTemplate).mockResolvedValue(true as any)
    expect(await (await DELETE(del(`?id=${ID}`))).json()).toEqual({ ok: true })
    expect(deleteTemplate).toHaveBeenCalledWith(ID)
  })

  it('returns 404 for a missing template', async () => {
    vi.mocked(deleteTemplate).mockResolvedValue(false as any)
    expect((await DELETE(del(`?id=${ID}`))).status).toBe(404)
  })
})

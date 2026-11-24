import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Arranging the studio's site by hand: free, no AI. The block helpers are the real @jeffi/site-blocks ones.

const m = vi.hoisted(() => {
  class LiteralEditError extends Error {}
  return {
    LiteralEditError,
    owner: vi.fn(),
    session: vi.fn(),
    savePage: vi.fn(),
    reload: vi.fn(),
    checkParts: vi.fn(),
    compile: vi.fn(),
    editLiterals: vi.fn(),
    literals: vi.fn(),
  }
})

vi.mock('@controller/lib/site-studio/http', async () => (await import('../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn() }))
vi.mock('@/lib/site/code/compile', () => ({ checkPageParts: m.checkParts, compileSection: m.compile }))
vi.mock('@/lib/site/code/literals', () => ({ codeLiterals: m.literals, editCodeLiterals: m.editLiterals, LiteralEditError: m.LiteralEditError }))
vi.mock('@/lib/showcase/types', () => ({ SHOWCASE_PAGE_KEY: 'showcase:home' }))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  getStudioSession: m.session,
  buildRunning: (s: { status: string }) => s.status === 'building',
  saveStudioPage: m.savePage,
}))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'used' }) }))
vi.mock('@controller/lib/site-studio/build', () => ({ reload: m.reload }))

import { GET, POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/edit/route'

const blk = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'text', props: { label: id }, ...extra })
const DOC = { order: ['a', 'b', 'c'], blocks: { a: blk('a'), b: blk('b'), c: blk('c', { type: 'code_section', props: { label: 'c', source: 'src' } }) } }
const SESSION = { id: 'sess-1', product: 'store', status: 'ready', pages: { 'store:home': DOC } }
const url = 'http://ecom.localhost/api/ecom/onboard/studio/edit'
const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue(SESSION)
  m.reload.mockResolvedValue(SESSION)
  m.checkParts.mockReturnValue([])
  m.literals.mockReturnValue([{ id: 'l1' }])
})

describe('GET /api/ecom/onboard/studio/edit', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await GET(new NextRequest(`${url}?page=store:home&blockId=c`))).status).toBe(401)
  })

  it('lists a code section’s literals, 404 for any other block', async () => {
    const ok = await GET(new NextRequest(`${url}?page=store:home&blockId=c`))
    expect(await ok.json()).toEqual({ literals: [{ id: 'l1' }] })
    expect(m.literals).toHaveBeenCalledWith('src')
    expect((await GET(new NextRequest(`${url}?page=store:home&blockId=a`))).status).toBe(404)
  })
})

describe('POST /api/ecom/onboard/studio/edit', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post({ page: 'store:home', blockId: 'a', op: 'hide', hidden: true })).status).toBe(401)
  })

  it('404s for a section that is gone, 409s mid-build, 400s for an unknown op', async () => {
    expect((await post({ page: 'store:home', blockId: 'zz', op: 'delete' })).status).toBe(404)
    expect((await post({ page: 'store:home', blockId: 'a', op: 'spin' })).status).toBe(400)
    m.session.mockResolvedValue({ ...SESSION, status: 'building' })
    const res = await post({ page: 'store:home', blockId: 'a', op: 'delete' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'running' })
    expect(m.savePage).not.toHaveBeenCalled()
  })

  it('moves a section before another and saves the page', async () => {
    const res = await post({ page: 'store:home', blockId: 'c', op: 'move', before: 'a' })
    expect(res.status).toBe(200)
    expect(m.savePage).toHaveBeenCalledWith('sess-1', 'store:home', expect.objectContaining({ order: ['c', 'a', 'b'] }))
  })

  it('deletes a section, but keeps a page’s last one', async () => {
    expect((await post({ page: 'store:home', blockId: 'b', op: 'delete' })).status).toBe(200)
    expect(m.savePage).toHaveBeenCalledWith('sess-1', 'store:home', expect.objectContaining({ order: ['a', 'c'] }))
    m.session.mockResolvedValue({ ...SESSION, pages: { 'store:home': { order: ['a'], blocks: { a: blk('a') } } } })
    expect((await post({ page: 'store:home', blockId: 'a', op: 'delete' })).status).toBe(400)
  })

  it('refuses to hide the only shown section and to delete one the page needs', async () => {
    m.session.mockResolvedValue({ ...SESSION, pages: { 'store:home': { ...DOC, blocks: { ...DOC.blocks, b: blk('b', { visibility: { hidden: true } }), c: blk('c', { visibility: { hidden: true } }) } } } })
    expect((await post({ page: 'store:home', blockId: 'a', op: 'hide', hidden: true })).status).toBe(400)
    m.session.mockResolvedValue(SESSION)
    m.checkParts.mockReturnValue([{ message: '<AddToCart> missing' }])
    const res = await post({ page: 'store:home', blockId: 'b', op: 'delete' })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('add to cart')
  })

  it('duplicates a section right after the original', async () => {
    expect((await post({ page: 'store:home', blockId: 'a', op: 'duplicate' })).status).toBe(200)
    const saved = m.savePage.mock.calls[0][2]
    expect(saved.order).toHaveLength(4)
    expect(saved.order[0]).toBe('a')
    expect(saved.blocks[saved.order[1]].props.label).toBe('a (copy)')
  })

  it('edits a code section’s words and recompiles it; 422s when the edit or compile fails', async () => {
    m.editLiterals.mockReturnValue('new src')
    m.compile.mockResolvedValue({ ok: true, section: { js: 1 } })
    const edits = [{ id: 'l1', from: 'x', to: 'y' }]
    const res = await post({ page: 'store:home', blockId: 'c', op: 'content', edits })
    expect(await res.json()).toMatchObject({ literals: [{ id: 'l1' }] })
    expect(m.compile).toHaveBeenCalledWith('new src', { page: 'home' })
    expect(m.savePage).toHaveBeenCalledWith('sess-1', 'store:home', expect.objectContaining({ blocks: expect.objectContaining({ c: expect.objectContaining({ props: { label: 'c', source: 'new src', compiled: { js: 1 } } }) }) }))

    m.compile.mockResolvedValue({ ok: false, issues: [{ message: 'syntax' }] })
    expect((await post({ page: 'store:home', blockId: 'c', op: 'content', edits })).status).toBe(422)
    m.editLiterals.mockImplementation(() => {
      throw new m.LiteralEditError('no match')
    })
    expect((await post({ page: 'store:home', blockId: 'c', op: 'content', edits })).status).toBe(422)
    expect((await post({ page: 'store:home', blockId: 'a', op: 'content', edits })).status).toBe(400)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The visual editor on a Showcase's page: behind site_editor_enabled, the request's own session, every tree compiled
// again on save (compileCodeProps) and the page kept to code sections.

const m = vi.hoisted(() => ({ owner: vi.fn(), session: vi.fn(), save: vi.fn(), flag: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: m.flag }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn() }))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  getStudioSession: m.session,
  buildRunning: (s: { status: string }) => s.status === 'building',
  saveStudioPage: m.save,
}))

import type { CodeNode, PageDoc } from '@jeffi/site-blocks'
import { compileSection, upgradeCodeSections } from '@/lib/site/code/compile'
import { SHOWCASE_TEMPLATES } from '@/lib/site/themes/templates/index'
import { GET, PUT } from '@controller/app/api/(ecom)/ecom/onboard/studio/design/route'

const SITE = '11111111-2222-3333-4444-555555555555'
const url = (q = '') => `https://ecom.example.com/api/ecom/onboard/studio/design?product=showcase&site=${SITE}${q}`
const put = (doc: unknown) => new NextRequest(url(), { method: 'PUT', body: JSON.stringify({ doc }) })

async function showcasePage(): Promise<PageDoc> {
  const tpl = Object.values(SHOWCASE_TEMPLATES as Record<string, { pages: Record<string, { sections: { label: string; source: string }[] }> }>)[0]
  // The whole page: it must keep its lead form.
  const sections = tpl.pages['showcase:home'].sections
  const blocks: PageDoc['blocks'] = {}
  for (const [i, s] of sections.entries()) {
    const r = await compileSection(s.source, { page: 'showcase' })
    if (!r.ok) throw new Error(r.issues[0].message)
    blocks[`b${i}`] = { id: `b${i}`, type: 'code_section', v: 1, props: { label: s.label, source: s.source, compiled: r.section } }
  }
  return { schemaVersion: 1, order: Object.keys(blocks), blocks }
}

beforeEach(async () => {
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.flag.mockResolvedValue(true)
  m.session.mockResolvedValue({ id: 'sess-1', product: 'showcase', status: 'ready', site_id: SITE, pages: { 'showcase:home': await showcasePage() } })
})

describe('studio design (visual editor)', () => {
  it('says whether the editor is on', async () => {
    m.flag.mockResolvedValue(false)
    expect(await (await GET(new NextRequest(url('&check=1')))).json()).toEqual({ enabled: false })
  })

  it('stays shut while the flag is off', async () => {
    m.flag.mockResolvedValue(false)
    expect((await GET(new NextRequest(url()))).status).toBe(404)
    expect((await PUT(put({}))).status).toBe(404)
  })

  it("loads the request's own session's page as trees", async () => {
    const res = await GET(new NextRequest(url()))
    expect(res.status).toBe(200)
    expect(m.session).toHaveBeenCalledWith('o-1', 'showcase', SITE)
    const { doc } = (await res.json()) as { doc: PageDoc }
    expect(doc.blocks.b0.props.tree).toBeTruthy()
    expect(String(doc.blocks.b0.props.source)).toContain('data-e=')
  })

  it('saves trees sent with an empty source, compiled again on the server', async () => {
    const loaded = upgradeCodeSections(await showcasePage(), 'showcase')
    const sent = { ...loaded, blocks: Object.fromEntries(Object.entries(loaded.blocks).map(([k, b]) => [k, { ...b, props: { ...b.props, source: '', compiled: null } }])) }
    const res = await PUT(put(sent))
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
    const [id, key, saved] = m.save.mock.calls[0] as [string, string, PageDoc]
    expect([id, key]).toEqual(['sess-1', 'showcase:home'])
    expect(saved.blocks.b0.props.source).toContain('data-e=')
    expect((saved.blocks.b0.props.compiled as { ast: CodeNode }).ast).toBeTruthy()
    expect(JSON.stringify(saved.blocks.b0.props.tree)).toBe(JSON.stringify(loaded.blocks.b0.props.tree))
  })

  it('refuses other blocks, an empty page, a bad tree and a running build', async () => {
    const page = await showcasePage()
    expect((await PUT(put({ ...page, blocks: { ...page.blocks, x: { id: 'x', type: 'rich_text', v: 1, props: {} } }, order: [...page.order, 'x'] }))).status).toBe(400)
    expect((await PUT(put({ schemaVersion: 1, order: [], blocks: {} }))).status).toBe(400)
    const bad = { ...page, blocks: { ...page.blocks, b0: { ...page.blocks.b0, props: { label: 'x', source: '', tree: { t: 'el', tag: 'script', props: {}, children: [] } } } } }
    const refused = await PUT(put(bad))
    expect(refused.status).toBe(422)
    expect((await refused.json()).error).toMatch(/script/i)
    m.session.mockResolvedValue({ id: 'sess-1', product: 'showcase', status: 'building', pages: {} })
    expect((await PUT(put(page))).status).toBe(409)
    expect(m.save).not.toHaveBeenCalled()
  })
})

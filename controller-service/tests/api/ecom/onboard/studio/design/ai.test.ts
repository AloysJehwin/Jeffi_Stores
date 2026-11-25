import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// "Change with AI" on a Showcase selection: one AI correction (the day's free ones, then the price shown), the section
// taken from the saved page, the change saved compiled inside the run.

const m = vi.hoisted(() => ({ owner: vi.fn(), session: vi.fn(), save: vi.fn(), flag: vi.fn(), claim: vi.fn(), change: vi.fn(), reload: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: m.flag }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn(async () => true) }))
vi.mock('@/lib/site/studio/selection', () => ({ changeSelection: m.change }))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: m.session, buildRunning: (s: { status: string }) => s.status === 'building', saveStudioPage: m.save }))
vi.mock('@controller/lib/site-studio/build', () => ({ reload: m.reload, studioCtx: () => ({}) }))
vi.mock('@controller/lib/site-studio/corrections', () => ({
  claimCorrection: m.claim,
  runCorrection: async (_c: unknown, _b: number, _l: string, fn: () => Promise<unknown>) => ({ result: await fn(), chargedInr: 20 }),
}))
vi.mock('@controller/lib/showcase-builder/build', () => ({ WALLET_URL: '/dashboard/wallet' }))

import type { CodeNode, PageDoc } from '@jeffi/site-blocks'
import { compileSection } from '@/lib/site/code/compile'
import { SHOWCASE_TEMPLATES } from '@/lib/site/themes/templates/index'
import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/design/ai/route'

const url = 'https://ecom.example.com/api/ecom/onboard/studio/design/ai?product=showcase&site=11111111-2222-3333-4444-555555555555'
const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }))

async function page(): Promise<PageDoc> {
  const tpl = Object.values(SHOWCASE_TEMPLATES as Record<string, { pages: Record<string, { sections: { label: string; source: string }[] }> }>)[0]
  const blocks: PageDoc['blocks'] = {}
  for (const [i, s] of tpl.pages['showcase:home'].sections.entries()) {
    const r = await compileSection(s.source, { page: 'showcase' })
    if (!r.ok) throw new Error(r.issues[0].message)
    blocks[`b${i}`] = { id: `b${i}`, type: 'code_section', v: 1, props: { label: s.label, source: s.source, compiled: r.section } }
  }
  return { schemaVersion: 1, order: Object.keys(blocks), blocks }
}

beforeEach(async () => {
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.flag.mockResolvedValue(true)
  m.session.mockResolvedValue({ id: 'sess-1', product: 'showcase', status: 'ready', pages: { 'showcase:home': await page() } })
  m.claim.mockResolvedValue({ ok: true, correction: {} })
  m.reload.mockResolvedValue({ id: 'sess-1', product: 'showcase', status: 'ready', pages: {} })
  m.change.mockImplementation(async (_ctx: unknown, p: { tree: CodeNode }) => ({ tree: p.tree, changed: ['e2'] }))
})

describe('studio design AI', () => {
  it('stays shut while the flag is off, and works on Showcase pages only', async () => {
    m.flag.mockResolvedValue(false)
    expect((await post({ blockId: 'b0', instruction: 'Bolder' })).status).toBe(404)
    m.flag.mockResolvedValue(true)
    m.session.mockResolvedValue({ id: 'sess-1', product: 'store', status: 'ready', pages: {} })
    expect((await post({ blockId: 'b0', instruction: 'Bolder' })).status).toBe(400)
  })

  it('claims one correction, changes the saved section and saves it compiled', async () => {
    const res = await post({ blockId: 'b0', ids: ['e2'], instruction: 'Bolder', priceInr: 20 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ changed: ['e2'], chargedInr: 20 })
    expect(body.allowance).toBeTruthy()
    expect(m.claim).toHaveBeenCalledWith(expect.objectContaining({ id: 'sess-1' }), 1, 20)
    expect(m.change.mock.calls[0][1]).toMatchObject({ ids: ['e2'], instruction: 'Bolder', page: 'showcase', key: 'showcase:home' })
    const saved = m.save.mock.calls[0][2] as PageDoc
    expect(String(saved.blocks.b0.props.source)).toContain('data-e=')
    expect(saved.blocks.b0.props.compiled).toBeTruthy()
  })

  it('passes a refused claim on and charges nothing for a missing section or a short request', async () => {
    m.claim.mockResolvedValue({ ok: false, status: 402, error: 'Add money', extra: { code: 'wallet_low' } })
    const refused = await post({ blockId: 'b0', instruction: 'Bolder' })
    expect([refused.status, (await refused.json()).code]).toEqual([402, 'wallet_low'])
    m.claim.mockClear()
    expect((await post({ blockId: 'nope', instruction: 'Bolder' })).status).toBe(404)
    expect((await post({ blockId: 'b0', instruction: 'x' })).status).toBe(400)
    expect(m.claim).not.toHaveBeenCalled()
    expect(m.save).not.toHaveBeenCalled()
  })
})

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The in-call build behind the call tools: a draft with an instant sketch and a preview link, a brief that fills the
// sketch at once and starts one background generation (queuing one follow-up), changes through the studio's revise
// paths, and publish with a claim link. The contact row and its events live in an in-memory table; the studio and
// the Showcase store are mocked.

const SYSTEM = { id: '99999999-9999-4999-8999-999999999999', email: 'outreach-system@jeffistores.in' }
const CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const h = vi.hoisted(() => {
  const db = {
    contacts: new Map<string, any>(),
    events: [] as { contact_id: string; kind: string; data: any; actor: string }[],
  }
  const run = async (sql: string, p: any[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim()
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q)) return { rows: [], rowCount: 0 }
    if (q.startsWith('SELECT * FROM outreach_contacts WHERE id = $1')) {
      const c = db.contacts.get(p[0])
      return { rows: c ? [structuredClone(c)] : [], rowCount: c ? 1 : 0 }
    }
    if (q.startsWith("UPDATE outreach_contacts SET extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb")) {
      const c = db.contacts.get(p[0])
      c.extra = { ...c.extra, ...JSON.parse(p[1]) }
      if (p[2]) c.showcase_site_id = p[2]
      return { rows: [], rowCount: 1 }
    }
    if (q.startsWith('INSERT INTO outreach_events')) {
      db.events.push({ contact_id: p[0], kind: p[2], data: p[3] ? JSON.parse(p[3]) : null, actor: p[4] })
      return { rows: [], rowCount: 1 }
    }
    if (q.startsWith('SELECT status FROM outreach_contacts WHERE id = $1 FOR UPDATE')) return { rows: [{ status: db.contacts.get(p[0]).status }] }
    if (q.startsWith('UPDATE outreach_contacts SET status = $2')) {
      const c = db.contacts.get(p[0])
      c.status = p[1]
      return { rows: [structuredClone(c)], rowCount: 1 }
    }
    throw new Error(`unexpected SQL: ${q}`)
  }
  const pool = { query: run, connect: async () => ({ query: run, release: () => {} }) }
  return {
    db,
    pool,
    site: null as any,
    session: null as any,
    getShowcaseById: vi.fn(),
    updateShowcase: vi.fn(),
    createShowcaseDraft: vi.fn(),
    checkShowcaseSlug: vi.fn(),
    mintPreview: vi.fn(),
    publishOwnerShowcase: vi.fn(),
    copyStudioPage: vi.fn(),
    startShowcaseStudio: vi.fn(),
    syncShowcaseStudio: vi.fn(),
    applyTheme: vi.fn(),
    getStudioSession: vi.fn(),
    claimRebuild: vi.fn(),
    settleRebuild: vi.fn(),
    saveStudioPage: vi.fn(),
    updateStudioSession: vi.fn(),
    createClaimToken: vi.fn(),
    startRun: vi.fn(),
    pushPage: vi.fn(),
    askJson: vi.fn(),
    tweakSection: vi.fn(),
    models: [] as string[],
  }
})

vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => h.pool }))
vi.mock('@controller/lib/outreach/claim', () => ({ ensureOutreachSystemOwner: async () => SYSTEM, createClaimToken: h.createClaimToken }))
vi.mock('@/lib/showcase/store', () => ({
  getShowcaseById: h.getShowcaseById,
  updateShowcase: h.updateShowcase,
  createShowcaseDraft: h.createShowcaseDraft,
  checkShowcaseSlug: h.checkShowcaseSlug,
  recordShowcaseGeneration: vi.fn(),
}))
vi.mock('@/lib/showcase/preview-token', () => ({ mintPreview: h.mintPreview }))
vi.mock('@controller/lib/showcase-builder/publish', () => ({ publishOwnerShowcase: h.publishOwnerShowcase, copyStudioPage: h.copyStudioPage }))
vi.mock('@controller/lib/showcase-builder/studio', () => ({ startShowcaseStudio: h.startShowcaseStudio, syncShowcaseStudio: h.syncShowcaseStudio, detailsAnswers: () => ({}) }))
vi.mock('@controller/lib/site-studio/themes', () => ({ applyTheme: h.applyTheme }))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  getStudioSession: h.getStudioSession,
  buildRunning: (s: { status: string }) => s.status === 'building',
  claimRebuild: h.claimRebuild,
  settleRebuild: h.settleRebuild,
  saveStudioPage: h.saveStudioPage,
  updateStudioSession: h.updateStudioSession,
}))
vi.mock('@controller/lib/site-studio/funded', () => ({ funded: (_id: string, _budget: number, fn: () => unknown) => fn() }))
vi.mock('@controller/lib/site-studio/build', () => ({ studioCtx: (s: { brief: unknown }) => ({ brief: s.brief }) }))
vi.mock('@controller/lib/outreach/build/run', () => ({ startRun: h.startRun, pushPage: h.pushPage, outreachModel: () => 'agent' }))
vi.mock('@/lib/site/studio/ai', () => ({ askJson: h.askJson }))
vi.mock('@/lib/site/studio', () => ({
  tweakSection: h.tweakSection,
  runStudioWithModel: (m: string, fn: () => unknown) => {
    h.models.push(m)
    return fn()
  },
}))

import { mergeBrief, OutreachBuildError, publish, requestChange, startDraft } from '@controller/lib/outreach/build'
import { directionOf } from '@controller/lib/outreach/build/sketch'

const contact = (over: Record<string, unknown> = {}) => ({
  id: CONTACT,
  status: 'interested',
  business_name: 'Lens & Light',
  category: 'Photographer',
  city: 'Chennai',
  language: 'ta',
  extra: {},
  showcase_site_id: null,
  ...over,
})
const DOC = { order: ['hdr', 'hero', 'svc'], blocks: { hdr: { id: 'hdr', props: { label: 'Header' } }, hero: { id: 'hero', props: { label: 'Opening' } }, svc: { id: 'svc', props: { label: 'Our services', source: 'x' }, visibility: { hidden: false } } } }
const events = (kind: string) => h.db.events.filter(e => e.kind === kind)
const row = () => h.db.contacts.get(CONTACT)

beforeEach(() => {
  vi.clearAllMocks()
  h.db.contacts.clear()
  h.db.events.length = 0
  h.models.length = 0
  h.db.contacts.set(CONTACT, contact())
  h.site = { id: SITE, ownerId: SYSTEM.id, slug: 'lens-light', status: 'draft', page: null, business: { name: 'Lens & Light', profession: 'Photographer', city: 'Chennai' }, content: {} }
  h.session = { id: 'sess-1', status: 'ready', direction: directionOf('minimalist.sage'), pages: { 'showcase:home': DOC }, brief: {} }
  h.getShowcaseById.mockImplementation(async (id: string) => (id === SITE && h.site ? { ...h.site } : null))
  h.updateShowcase.mockImplementation(async (_id: string, patch: any) => (h.site = { ...h.site, ...patch, updatedAt: 'later' }))
  h.checkShowcaseSlug.mockImplementation(async (slug: string) => (slug === 'lens-light' ? { ok: false, error: 'taken' } : { ok: true, slug }))
  h.createShowcaseDraft.mockImplementation(async (input: any) => ({ ok: true, site: (h.site = { ...h.site, slug: input.slug, business: input.business, ownerId: input.ownerId }) }))
  h.mintPreview.mockResolvedValue({ token: 't', jti: 'j', expiresAt: '2026-11-25T10:00:00.000Z', url: 'https://site-lens-light-chennai.jeffistores.in/preview?t=tok' })
  h.startShowcaseStudio.mockResolvedValue(h.session)
  h.applyTheme.mockImplementation(async (s: any, themeId: string) => {
    h.site = { ...h.site, page: DOC }
    return { ok: true, session: { ...s, direction: directionOf(themeId) } }
  })
  h.getStudioSession.mockImplementation(async () => h.session)
  h.syncShowcaseStudio.mockImplementation(async (s: unknown) => s)
  h.claimRebuild.mockImplementation(async () => ({ ...h.session, status: 'building' }))
  h.settleRebuild.mockResolvedValue({ ...h.session, status: 'ready' })
  h.updateStudioSession.mockImplementation(async (_id: string, patch: any) => (h.session = { ...h.session, ...patch }))
  h.pushPage.mockResolvedValue(true)
  h.createClaimToken.mockResolvedValue({ token: 'claim-tok', expiresAt: '2026-12-08T00:00:00.000Z', url: 'https://ecom.jeffistores.in/claim/claim-tok' })
})

describe('startDraft', () => {
  it('makes a draft held by the outreach owner, wearing a sketch at once, with a preview link', async () => {
    const r = await startDraft(CONTACT, { businessName: ' Lens  & Light ', language: 'ta' })
    expect(r).toEqual({ siteId: SITE, previewUrl: 'https://site-lens-light-chennai.jeffistores.in/preview?t=tok' })
    const draft = h.createShowcaseDraft.mock.calls[0][0]
    expect(draft).toMatchObject({ ownerId: SYSTEM.id, tenantId: null, slug: 'lens-light-chennai', business: { name: 'Lens & Light', profession: 'Photographer', city: 'Chennai' } })
    expect(h.applyTheme).toHaveBeenCalledWith(h.session, expect.stringMatching(/^minimalist\./), { replace: true })
    expect(row()).toMatchObject({ showcase_site_id: SITE, status: 'building', extra: { build: { state: 'idle', builds: 0, callLanguage: 'ta' } } })
    expect(events('draft_started')[0].data).toMatchObject({ site_id: SITE, slug: 'lens-light-chennai', previewUrl: r.previewUrl })
    expect(events('status_change')[0].data).toMatchObject({ from: 'interested', to: 'building' })
  })

  it('is idempotent per contact: the same site, a fresh link, the name kept up to date', async () => {
    await startDraft(CONTACT, { businessName: 'Lens & Light', language: 'ta' })
    const again = await startDraft(CONTACT, { businessName: 'Lens and Light Studio', language: 'ta' })
    expect(again.siteId).toBe(SITE)
    expect(h.createShowcaseDraft).toHaveBeenCalledTimes(1)
    expect(h.applyTheme).toHaveBeenCalledTimes(1)
    expect(h.updateShowcase).toHaveBeenCalledWith(SITE, { business: expect.objectContaining({ name: 'Lens and Light Studio' }) })
    expect(events('preview_link')).toHaveLength(1)
    expect(h.mintPreview).toHaveBeenCalledTimes(2)
  })

  it('moves a contact still in its call through interested', async () => {
    h.db.contacts.set(CONTACT, contact({ status: 'calling' }))
    await startDraft(CONTACT, { businessName: 'Lens & Light', language: 'en' })
    expect(events('status_change').map(e => e.data.to)).toEqual(['interested', 'building'])
  })

  it('refuses an unknown contact, and builds nothing for one that opted out', async () => {
    await expect(startDraft('00000000-0000-4000-8000-000000000000', { businessName: 'X', language: 'en' })).rejects.toBeInstanceOf(OutreachBuildError)
    h.db.contacts.set(CONTACT, contact({ status: 'opted_out', opted_out_at: '2026-11-24T09:00:00Z' }))
    await expect(startDraft(CONTACT, { businessName: 'Lens & Light', language: 'en' })).rejects.toMatchObject({ code: 'opted_out' })
    await expect(mergeBrief(CONTACT, { whatTheyDo: 'x' })).rejects.toMatchObject({ code: 'opted_out' })
    expect((await requestChange(CONTACT, 'make it blue')).ok).toBe(false)
    expect(h.createShowcaseDraft).not.toHaveBeenCalled()
  })
})

describe('mergeBrief', () => {
  beforeEach(async () => {
    await startDraft(CONTACT, { businessName: 'Lens & Light', language: 'ta' })
    h.db.events.length = 0
  })

  it('fills the sketch at once and says what to ask next, without starting a generation yet', async () => {
    const r = await mergeBrief(CONTACT, { whatTheyDo: 'Wedding photography in Chennai.', hours: 'Mon-Sat 10-7', contact: { phone: '9840012345' } })
    expect(r).toEqual({ building: false, missing: ['audience', 'highlights', 'address', 'style'] })
    expect(row().extra.brief).toEqual({ whatTheyDo: 'Wedding photography in Chennai.', hours: 'Mon-Sat 10-7', contact: { phone: '9840012345' } })
    expect(h.site.business).toMatchObject({ name: 'Lens & Light', tagline: 'Wedding photography in Chennai', hours: 'Mon-Sat 10-7', phone: '9840012345' })
    expect(h.syncShowcaseStudio).toHaveBeenCalled()
    expect(h.startRun).not.toHaveBeenCalled()
    expect(events('brief_updated')[0].data.keys).toEqual(['whatTheyDo', 'hours', 'contact'])
  })

  it('starts one background generation once enough is known, and queues one follow-up while it runs', async () => {
    await mergeBrief(CONTACT, { whatTheyDo: 'Wedding photography' })
    const first = await mergeBrief(CONTACT, { audience: 'Couples planning a wedding' })
    expect(first.building).toBe(true)
    expect(h.startRun).toHaveBeenCalledTimes(1)
    const runId = h.startRun.mock.calls[0][1]
    expect(row().extra.build).toMatchObject({ state: 'running', runId, builds: 1, queued: false })
    await mergeBrief(CONTACT, { highlights: ['Drone shots'] })
    await mergeBrief(CONTACT, { highlights: ['Same-day edits'] })
    expect(h.startRun).toHaveBeenCalledTimes(1)
    expect(row().extra.build).toMatchObject({ queued: true, builds: 1 })
    expect(events('build_started')).toHaveLength(1)
    expect(events('build_queued')).toHaveLength(1)
  })

  it('does not design again for details the page shows live', async () => {
    await mergeBrief(CONTACT, { whatTheyDo: 'Bakery', audience: 'Families' })
    const b = row().extra.build
    h.db.contacts.get(CONTACT).extra.build = { ...b, state: 'done', builtAt: '2026-11-24T10:02:00.000Z' }
    const r = await mergeBrief(CONTACT, { hours: '8-8', address: '12 Anna Salai' })
    expect(r.building).toBe(false)
    expect(h.startRun).toHaveBeenCalledTimes(1)
    expect(h.site.business).toMatchObject({ hours: '8-8', address: '12 Anna Salai' })
  })

  it('re-themes the sketch for a look asked for before the full design', async () => {
    await mergeBrief(CONTACT, { style: 'bold and orange' })
    expect(h.applyTheme).toHaveBeenLastCalledWith(expect.anything(), 'brutalist.safety-orange', { replace: true })
  })

  it('starts the draft itself when the call gave details first', async () => {
    h.db.contacts.set(CONTACT, contact())
    h.createShowcaseDraft.mockClear()
    await mergeBrief(CONTACT, { whatTheyDo: 'Tuition classes' })
    expect(h.createShowcaseDraft).toHaveBeenCalledTimes(1)
    expect(row().showcase_site_id).toBe(SITE)
  })
})

describe('requestChange', () => {
  beforeEach(async () => {
    await startDraft(CONTACT, { businessName: 'Lens & Light', language: 'ta' })
    await mergeBrief(CONTACT, { whatTheyDo: 'Wedding photography', audience: 'Couples' })
    h.db.contacts.get(CONTACT).extra.build = { ...row().extra.build, state: 'done', builtAt: '2026-11-24T10:02:00.000Z' }
    h.db.events.length = 0
    h.startRun.mockClear()
  })

  it('folds a change into the next design while the first is not done', async () => {
    h.db.contacts.get(CONTACT).extra.build = { state: 'running', builds: 1, runId: 'r', hash: 'x', startedAt: new Date().toISOString() }
    const r = await requestChange(CONTACT, 'show more wedding photos')
    expect(r.ok).toBe(true)
    expect(r.summary).toMatch(/working that into the design/)
    expect(row().extra.brief.changes).toEqual(['show more wedding photos'])
    expect(row().extra.build.queued).toBe(true)
    expect(h.tweakSection).not.toHaveBeenCalled()
  })

  it('rewrites the one section asked about through the studio tweak, on the faster model', async () => {
    h.askJson.mockResolvedValue({ target: 'section', section: 2 })
    h.tweakSection.mockResolvedValue({ id: 'new', type: 'code_section', props: { label: 'Our services', source: 'y' } })
    const r = await requestChange(CONTACT, 'add candid shoots to the services')
    expect(r).toEqual({ ok: true, summary: "Done. I've updated the services section; it's on your preview now." })
    expect(h.tweakSection.mock.calls[0][1]).toBe(DOC.blocks.svc)
    expect(h.tweakSection.mock.calls[0][2]).toBe('add candid shoots to the services')
    const saved = h.saveStudioPage.mock.calls[0][2]
    expect(saved.blocks.svc).toMatchObject({ id: 'svc', props: { source: 'y' }, visibility: { hidden: false } })
    expect(h.settleRebuild).toHaveBeenCalledWith('sess-1')
    expect(h.pushPage).toHaveBeenCalled()
    expect(h.models).toEqual(['agent'])
    expect(events('change_applied')[0].data.section).toBe('Our services')
  })

  it('changes only the colours with another palette, no AI rewrite', async () => {
    h.askJson.mockResolvedValue({ target: 'colours', section: null })
    const r = await requestChange(CONTACT, 'can it be blue instead')
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('Ocean')
    expect(h.updateStudioSession).toHaveBeenCalledWith('sess-1', expect.objectContaining({ direction: expect.objectContaining({ name: expect.stringContaining('Ocean') }) }))
    expect(h.tweakSection).not.toHaveBeenCalled()
    expect(row().extra.brief.style).toBe('can it be blue instead')
    expect(h.startRun).not.toHaveBeenCalled()
  })

  it('says sorry, keeps the page and records it when the AI fails', async () => {
    h.askJson.mockRejectedValue(new Error('gateway down'))
    h.tweakSection.mockRejectedValue(new Error('could not compile'))
    const r = await requestChange(CONTACT, 'change the services layout')
    expect(r.ok).toBe(false)
    expect(h.saveStudioPage).not.toHaveBeenCalled()
    expect(h.settleRebuild).toHaveBeenCalled()
    expect(events('change_failed')[0].data).toMatchObject({ section: 'Our services', error: 'could not compile' })
  })

  it('asks again for an empty instruction', async () => {
    expect(await requestChange(CONTACT, ' ok ')).toEqual({ ok: false, summary: 'What would you like me to change on the site?' })
  })
})

describe('publish', () => {
  beforeEach(async () => {
    await startDraft(CONTACT, { businessName: 'Lens & Light', language: 'ta' })
    await mergeBrief(CONTACT, { whatTheyDo: 'Wedding photography', audience: 'Couples', contact: { phone: '9840012345' } })
    h.db.events.length = 0
  })

  it('refuses until a full design has finished', async () => {
    await expect(publish(CONTACT)).rejects.toMatchObject({ code: 'building' })
    h.db.contacts.get(CONTACT).extra.build = { state: 'failed', builds: 1 }
    await expect(publish(CONTACT)).rejects.toMatchObject({ code: 'not_built' })
    expect(h.publishOwnerShowcase).not.toHaveBeenCalled()
  })

  it('goes live (the trial starts) and hands back the live and claim links', async () => {
    h.db.contacts.get(CONTACT).extra.build = { state: 'done', builds: 1, builtAt: '2026-11-24T10:02:00.000Z' }
    h.publishOwnerShowcase.mockResolvedValue({ ok: true, url: 'https://site-lens-light-chennai.jeffistores.in', first: true, site: { ...h.site, status: 'live', slug: 'lens-light-chennai', trialEndsAt: '2026-12-01T10:00:00.000Z' } })
    const r = await publish(CONTACT)
    expect(r).toEqual({ liveUrl: 'https://site-lens-light-chennai.jeffistores.in', claimUrl: 'https://ecom.jeffistores.in/claim/claim-tok' })
    expect(h.publishOwnerShowcase).toHaveBeenCalledWith(SYSTEM.id, SITE)
    expect(h.createClaimToken).toHaveBeenCalledWith(CONTACT)
    expect(events('published')[0].data).toMatchObject({ liveUrl: r.liveUrl, claimLinkCreated: true, claimExpiresAt: '2026-12-08T00:00:00.000Z', first: true })
    const stored = JSON.stringify([...h.db.events])
    expect(stored).not.toContain('claim-tok')
    expect(stored).not.toContain('/claim/')
    expect(row().status).toBe('published')
  })

  it('says what is missing when the site has no way to reach the business', async () => {
    h.db.contacts.get(CONTACT).extra.build = { state: 'done', builds: 1, builtAt: '2026-11-24T10:02:00.000Z' }
    h.publishOwnerShowcase.mockResolvedValue({ ok: false, status: 400, code: 'details', error: 'Add a phone number' })
    await expect(publish(CONTACT)).rejects.toMatchObject({ code: 'details', message: expect.stringContaining('phone number') })
    expect(h.createClaimToken).not.toHaveBeenCalled()
  })
})

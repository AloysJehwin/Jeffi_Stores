// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The background generation: the first is the studio's free Showcase generation on the faster model, platform-funded;
// a follow-up queued meanwhile is the studio's "design this page again" from the newer brief; a failure leaves the
// page alone and is recorded, never thrown.

const SYSTEM = { id: '99999999-9999-4999-8999-999999999999' }
const CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const h = vi.hoisted(() => ({
  contact: null as any,
  writes: [] as any[],
  events: [] as { kind: string; data: any }[],
  session: null as any,
  models: [] as string[],
  budgets: [] as number[],
  getShowcaseById: vi.fn(),
  getStudioSession: vi.fn(),
  getStudioSessionById: vi.fn(),
  updateStudioSession: vi.fn(),
  claimBuild: vi.fn(),
  claimRebuild: vi.fn(),
  runShowcaseBuild: vi.fn(),
  runPageRebuild: vi.fn(),
  showcaseBrief: vi.fn(),
  planShowcase: vi.fn(),
  copyStudioPage: vi.fn(),
  recordShowcaseGeneration: vi.fn(),
}))

vi.mock('@controller/lib/outreach/contacts', () => ({ getContact: async () => structuredClone(h.contact) }))
vi.mock('@controller/lib/outreach/events', () => ({ recordEvent: async (_c: string, kind: string, o: { data?: unknown }) => void h.events.push({ kind, data: o?.data }) }))
vi.mock('@controller/lib/outreach/claim', () => ({ ensureOutreachSystemOwner: async () => SYSTEM }))
vi.mock('@controller/lib/outreach/build/state', async orig => ({
  ...(await orig<typeof import('@controller/lib/outreach/build/state')>()),
  withContact: async (_id: string, fn: (c: unknown, tx: unknown) => unknown) => fn(structuredClone(h.contact), {}),
  writeExtra: async (_tx: unknown, _id: string, patch: Record<string, unknown>) => {
    h.writes.push(patch)
    h.contact.extra = { ...h.contact.extra, ...patch }
  },
}))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById: h.getShowcaseById, recordShowcaseGeneration: h.recordShowcaseGeneration, checkShowcaseSlug: vi.fn(), createShowcaseDraft: vi.fn() }))
vi.mock('@controller/lib/site-studio/themes', () => ({ applyTheme: vi.fn() }))
vi.mock('@controller/lib/showcase-builder/build', () => ({ runShowcaseBuild: h.runShowcaseBuild }))
vi.mock('@controller/lib/showcase-builder/publish', () => ({ copyStudioPage: h.copyStudioPage, publishOwnerShowcase: vi.fn() }))
vi.mock('@controller/lib/showcase-builder/studio', () => ({ detailsAnswers: () => ({ storeName: 'Lens & Light' }), startShowcaseStudio: vi.fn() }))
vi.mock('@controller/lib/site-studio/build', () => ({ runPageRebuild: h.runPageRebuild }))
vi.mock('@controller/lib/site-studio/funded', () => ({
  freeBudgetLeft: (s: { spent_inr: number }) => 150 - s.spent_inr,
  funded: (_id: string, budget: number, fn: () => unknown) => {
    h.budgets.push(budget)
    return fn()
  },
}))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  claimBuild: h.claimBuild,
  claimRebuild: h.claimRebuild,
  getStudioSession: h.getStudioSession,
  getStudioSessionById: h.getStudioSessionById,
  updateStudioSession: h.updateStudioSession,
}))
vi.mock('@/lib/site/studio', () => ({
  cleanAnswers: (a: Record<string, unknown>) => a,
  showcaseBrief: h.showcaseBrief,
  planShowcase: h.planShowcase,
  runStudioWithModel: (m: string, fn: () => unknown) => {
    h.models.push(m)
    return fn()
  },
}))

import { runLoop } from '@controller/lib/outreach/build/run'
import { briefHash } from '@controller/lib/outreach/build/brief'
import { directionOf } from '@controller/lib/outreach/build/sketch'

const BRIEF = { whatTheyDo: 'Wedding photography', audience: 'Couples' }
const site = { id: SITE, ownerId: SYSTEM.id, status: 'draft', slug: 'lens', business: { name: 'Lens & Light' }, content: {} }
const running = (over: Record<string, unknown> = {}) => ({ state: 'running', runId: 'run-1', builds: 1, hash: briefHash(BRIEF), startedAt: new Date().toISOString(), ...over })

beforeEach(() => {
  vi.clearAllMocks()
  h.writes.length = 0
  h.events.length = 0
  h.models.length = 0
  h.budgets.length = 0
  delete process.env.OUTREACH_STUDIO_MODEL
  h.contact = { id: CONTACT, status: 'building', showcase_site_id: SITE, extra: { brief: BRIEF, build: running() } }
  h.session = { id: 'sess-1', status: 'ready', generated_at: null, spent_inr: 0, answers: { sell: 'old' }, direction: directionOf('minimalist.sage'), pages: {} }
  h.getShowcaseById.mockResolvedValue(site)
  h.getStudioSession.mockImplementation(async () => h.session)
  h.getStudioSessionById.mockImplementation(async () => ({ ...h.session, spent_inr: 42.5 }))
  h.updateStudioSession.mockImplementation(async (_id: string, patch: any) => (h.session = { ...h.session, ...patch }))
  h.showcaseBrief.mockResolvedValue({ storeName: 'Lens & Light', kind: 'showcase' })
  h.planShowcase.mockResolvedValue({ pages: [{ key: 'showcase:home' }] })
  h.claimBuild.mockImplementation(async () => ({ ...h.session, status: 'building' }))
  h.claimRebuild.mockImplementation(async () => ({ ...h.session, status: 'building' }))
  h.runShowcaseBuild.mockResolvedValue({ status: 'ready', pages: { 'showcase:home': { order: ['a'] } } })
  h.runPageRebuild.mockResolvedValue({ status: 'ready' })
  h.recordShowcaseGeneration.mockResolvedValue(2)
  h.copyStudioPage.mockResolvedValue(true)
})

describe('the background generation', () => {
  it('runs the studio’s free Showcase generation on the faster model from the call’s brief', async () => {
    await runLoop(CONTACT, 'run-1')
    expect(h.models).toEqual(['agent'])
    expect(h.updateStudioSession).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      answers: expect.objectContaining({ sell: 'Wedding photography', audience: 'Couples', storeName: 'Lens & Light' }),
      brief: { storeName: 'Lens & Light', kind: 'showcase' },
      plan: { pages: [{ key: 'showcase:home' }] },
      direction: h.session.direction,
    }))
    expect(h.runShowcaseBuild).toHaveBeenCalledWith(expect.objectContaining({ status: 'building' }), site, expect.any(Function))
    expect(h.runPageRebuild).not.toHaveBeenCalled()
    expect(h.events.map(e => e.kind)).toEqual(['build_finished'])
    expect(h.events[0].data).toMatchObject({ kind: 'first', spent_inr: 42.5 })
    expect(h.contact.extra.build).toMatchObject({ state: 'done', queued: false, builds: 1 })
    expect(h.contact.extra.build.builtAt).toBeTruthy()
  })

  it('honours OUTREACH_STUDIO_MODEL', async () => {
    process.env.OUTREACH_STUDIO_MODEL = 'fast'
    await runLoop(CONTACT, 'run-1')
    expect(h.models).toEqual(['fast'])
  })

  it('records a failed generation and leaves the page alone', async () => {
    h.runShowcaseBuild.mockResolvedValue({ status: 'failed', error: 'The AI stopped before your page was finished.', pages: {} })
    await runLoop(CONTACT, 'run-1')
    expect(h.copyStudioPage).not.toHaveBeenCalled()
    expect(h.events[0]).toMatchObject({ kind: 'build_failed', data: { error: 'The AI stopped before your page was finished.' } })
    expect(h.contact.extra.build).toMatchObject({ state: 'failed' })
    expect(h.contact.extra.build.builtAt).toBeUndefined()
  })

  it('never throws, even when the AI is down before the build', async () => {
    h.showcaseBrief.mockRejectedValue(new Error('Claude is unavailable'))
    await expect(runLoop(CONTACT, 'run-1')).resolves.toBeUndefined()
    expect(h.events[0]).toMatchObject({ kind: 'build_failed', data: { error: 'Claude is unavailable' } })
  })

  it('runs one queued follow-up through the studio’s page redesign, then stops', async () => {
    h.contact.extra.build = running({ queued: true })
    h.runShowcaseBuild.mockImplementation(async () => {
      // The call added highlights while the first design ran.
      h.contact.extra.brief = { ...BRIEF, highlights: ['Drone shots'] }
      h.session = { ...h.session, generated_at: '2026-11-24T10:02:00Z', pages: { 'showcase:home': { order: ['a'] } } }
      return { status: 'ready', pages: { 'showcase:home': { order: ['a'] } } }
    })
    await runLoop(CONTACT, 'run-1')
    expect(h.runShowcaseBuild).toHaveBeenCalledTimes(1)
    expect(h.runPageRebuild).toHaveBeenCalledTimes(1)
    const [claimed, key, , opts] = h.runPageRebuild.mock.calls[0]
    expect([claimed.status, key]).toEqual(['building', 'showcase:home'])
    // The rebuild is platform-funded on a full page's budget, never charged.
    await expect(opts.run(60, async () => 'x')).resolves.toEqual({ result: 'x', chargedInr: 0 })
    expect(h.budgets.at(-1)).toBe(150)
    expect(h.updateStudioSession.mock.calls.at(-1)![1].answers.notes).toContain('Drone shots')
    expect(h.copyStudioPage).toHaveBeenCalledTimes(1)
    expect(h.recordShowcaseGeneration).toHaveBeenCalledWith(SITE)
    expect(h.events.map(e => e.kind)).toEqual(['build_finished', 'build_started', 'build_finished'])
    expect(h.contact.extra.build).toMatchObject({ state: 'done', builds: 2, queued: false, hash: briefHash({ ...BRIEF, highlights: ['Drone shots'] }) })
  })

  it('stops when another run took over, and when the site was claimed', async () => {
    h.contact.extra.build = running({ runId: 'run-2' })
    await runLoop(CONTACT, 'run-1')
    expect(h.writes).toHaveLength(0)
    h.getShowcaseById.mockResolvedValue({ ...site, ownerId: 'someone-else' })
    h.contact.extra.build = running()
    await runLoop(CONTACT, 'run-1')
    expect(h.runShowcaseBuild).toHaveBeenCalledTimes(1)
    expect(h.events.at(-1)).toMatchObject({ kind: 'build_failed', data: { error: 'the site was claimed' } })
  })
})

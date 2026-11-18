import { describe, it, expect, vi, beforeEach } from 'vitest'

// A Showcase redesign's run: a flat ₹50 through runPaidGeneration (its own tests cover the hold and the refund), with
// everything up to the saved page inside the paid run, so a redesign that fails is never charged.

const m = vi.hoisted(() => ({
  generatePage: vi.fn(),
  regeneratePage: vi.fn(),
  saveStudioPage: vi.fn(),
  updateStudioSession: vi.fn(),
  settlePaidBuild: vi.fn(),
  recordShowcaseGeneration: vi.fn(),
  copyStudioPage: vi.fn(),
  runPaidGeneration: vi.fn(),
  failedInside: [] as unknown[],
}))

vi.mock('@/lib/site/studio', () => ({
  generatePage: m.generatePage,
  regeneratePage: m.regeneratePage,
  StudioAiDownError: class StudioAiDownError extends Error {},
  StudioBudgetError: class StudioBudgetError extends Error {},
}))
vi.mock('@/lib/ai/paid-generation', () => ({
  runPaidGeneration: m.runPaidGeneration,
  PaidGenerationError: class PaidGenerationError extends Error {
    constructor(readonly code: string, message: string, readonly neededInr = 0) {
      super(message)
    }
    body() {
      return { error: this.message, code: this.code, neededInr: this.neededInr }
    }
  },
}))
vi.mock('@/lib/showcase/store', () => ({ claimFreeShowcaseGeneration: vi.fn(), recordShowcaseGeneration: m.recordShowcaseGeneration }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable' }))
vi.mock('@controller/lib/site-studio/build', () => ({ studioCtx: (s: { plan: unknown }) => ({ plan: s.plan, brief: {}, direction: {} }) }))
vi.mock('@controller/lib/site-studio/funded', () => ({ freeBudgetLeft: () => 100, funded: vi.fn() }))
vi.mock('@controller/lib/showcase-builder/publish', () => ({ copyStudioPage: m.copyStudioPage }))
vi.mock('@controller/lib/showcase-builder/starter', () => ({ addStarterContent: vi.fn() }))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  finishBuild: vi.fn(),
  saveStudioPage: m.saveStudioPage,
  settlePaidBuild: m.settlePaidBuild,
  updateStudioSession: m.updateStudioSession,
}))

import { runShowcasePaidBuild } from '@controller/lib/showcase-builder/build'
import { PaidGenerationError } from '@/lib/ai/paid-generation'
import { StudioAiDownError } from '@/lib/site/studio'

const TENANT = '11111111-1111-1111-1111-111111111111'
const PAGE = { key: 'showcase:home', label: 'Your page', sections: [{ label: 'Hero' }] }
const FRESH = { ...PAGE, sections: [{ label: 'Story' }] }
const DOC = { blocks: { b1: {} }, order: ['b1'] }
const session = (pages: Record<string, unknown> = {}) => ({ id: 'sess-1', product: 'showcase', plan: { pages: [PAGE] }, pages }) as never
const site = { id: 'site-1', slug: 'lens', status: 'live', tenantId: TENANT } as never

function run(s = session()) {
  const events: [string, any][] = []
  return { events, done: runShowcasePaidBuild(s, site, (e, d) => events.push([e, d])) }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.failedInside.length = 0
  m.generatePage.mockResolvedValue(DOC)
  m.regeneratePage.mockResolvedValue({ page: FRESH, doc: DOC })
  m.settlePaidBuild.mockResolvedValue({ id: 'sess-1', status: 'ready' })
  m.recordShowcaseGeneration.mockResolvedValue(2)
  // Flat: the price when fn delivers; what fn throws comes back out (and runPaidGeneration refunds the hold).
  m.runPaidGeneration.mockImplementation(async (g: { capInr: number }, fn: () => Promise<unknown>) => {
    try {
      return { chargedInr: g.capInr, costInr: 7, result: await fn() }
    } catch (err) {
      m.failedInside.push(err)
      throw err
    }
  })
})

describe('runShowcasePaidBuild', () => {
  it('charges a flat ₹50 with the free design’s AI budget, once the new page is saved', async () => {
    let savedFirst = false
    m.runPaidGeneration.mockImplementationOnce(async (g: { capInr: number }, fn: () => Promise<unknown>) => {
      const result = await fn()
      savedFirst = m.saveStudioPage.mock.calls.length === 1
      return { chargedInr: g.capInr, costInr: 7, result }
    })
    const { events, done } = run()
    expect(await done).toMatchObject({ chargedInr: 50 })
    expect(m.runPaidGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, capInr: 50, flat: { budgetInr: 150 }, feature: 'showcase_generation', label: 'Showcase redesign for site-lens', ref: expect.stringMatching(/^showcase:site-1:/) }),
      expect.any(Function)
    )
    expect(savedFirst).toBe(true)
    expect(m.saveStudioPage).toHaveBeenCalledWith('sess-1', 'showcase:home', DOC, expect.objectContaining({ done: ['showcase:home'] }))
    expect(events).toContainEqual(['page-done', { key: 'showcase:home', label: 'Your page', chargedInr: 50 }])
    expect(m.recordShowcaseGeneration).toHaveBeenCalledWith('site-1')
    expect(m.settlePaidBuild).toHaveBeenCalledWith('sess-1')
  })

  it('plans an existing page again and keeps the fresh plan', async () => {
    const { done } = run(session({ 'showcase:home': DOC }))
    await done
    expect(m.regeneratePage).toHaveBeenCalled()
    expect(m.generatePage).not.toHaveBeenCalled()
    expect(m.updateStudioSession).toHaveBeenCalledWith('sess-1', { plan: { pages: [FRESH] } })
  })

  it('fails inside the paid run when no section could be written, so the ₹50 goes back', async () => {
    m.generatePage.mockResolvedValue({ blocks: {}, order: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { events, done } = run()
    expect(await done).toMatchObject({ chargedInr: 0 })
    expect(m.failedInside).toHaveLength(1)
    expect(m.saveStudioPage).not.toHaveBeenCalled()
    const failed = events.find(([e]) => e === 'page-failed')?.[1]
    expect(failed.error).toMatch(/you were not charged/)
    expect(m.settlePaidBuild).toHaveBeenCalledWith('sess-1', failed.error)
    expect(m.recordShowcaseGeneration).not.toHaveBeenCalled()
  })

  it('fails inside the paid run when the page cannot be saved', async () => {
    m.saveStudioPage.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { done } = run()
    expect(await done).toMatchObject({ chargedInr: 0 })
    expect(m.failedInside).toHaveLength(1)
  })

  it('says Claude is down without charging', async () => {
    m.generatePage.mockRejectedValue(new (StudioAiDownError as any)('AI is down.'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { events, done } = run()
    await done
    expect(events.find(([e]) => e === 'page-failed')?.[1].error).toBe('AI is down. Your page is as it was, and you were not charged.')
    expect(events).toContainEqual(['error', { error: 'AI is down. Your page is as it was, and you were not charged.', code: 'ai_unavailable' }])
  })

  it('sends a wallet that could not hold the ₹50 to top up, and runs nothing', async () => {
    m.runPaidGeneration.mockRejectedValue(new (PaidGenerationError as any)('wallet_low', 'Your AI wallet needs ₹10.00 more: this costs ₹50.', 10))
    const { events, done } = run()
    expect(await done).toMatchObject({ chargedInr: 0 })
    expect(events).toContainEqual(['error', { error: 'Your AI wallet needs ₹10.00 more: this costs ₹50.', code: 'wallet_low', neededInr: 10, priceInr: 50, topUpUrl: '/dashboard/wallet' }])
    expect(m.generatePage).not.toHaveBeenCalled()
    expect(m.settlePaidBuild).toHaveBeenCalledWith('sess-1', 'Your AI wallet needs ₹10.00 more: this costs ₹50.')
  })
})

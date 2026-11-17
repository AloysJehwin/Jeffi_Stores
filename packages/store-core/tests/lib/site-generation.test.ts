import { describe, it, expect, vi, beforeEach } from 'vitest'

// Site Builder's whole-site redesign: who pays (free, paid after the price was shown, a stopped free build carried on
// free), and the one-build-per-store slot. The build itself (lib/site/studio/redesign.ts) and the wallet runs
// (lib/ai/paid-generation.ts) are stubbed: these tests hold the decision around them.

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/integrations/owner', () => ({ isPlatformOwner: (id: string) => id === 'platform' }))
vi.mock('@/lib/payments/wallet', () => ({ getWalletBalance: vi.fn() }))
vi.mock('@/lib/site/studio/ai', () => ({ STUDIO_BUDGET_INR: () => 1000 }))
vi.mock('@/lib/ai/paid-generation', () => {
  class PaidGenerationError extends Error {
    readonly status = 409
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  }
  return {
    PaidGenerationError,
    estimateGeneration: () => ({ lowInr: 675, highInr: 1200, capInr: 1500 }),
    siteRegenCapInr: () => 1500,
    runFreeGeneration: vi.fn(async (_label: string, _budget: number, fn: () => Promise<unknown>) => ({ costInr: 12, result: await fn() })),
    runPaidGeneration: vi.fn(async (_g: unknown, fn: () => Promise<unknown>) => ({ costInr: 500, chargedInr: 750, result: await fn() })),
  }
})
vi.mock('@/lib/site/studio/redesign', () => ({
  activeRedesign: vi.fn(),
  beatRedesign: vi.fn(async () => true),
  bindRedesign: vi.fn(async () => {}),
  claimRedesign: vi.fn(),
  noteRedesignCharge: vi.fn(async () => {}),
  redesignInDraft: vi.fn(),
  releaseRedesign: vi.fn(async () => {}),
  resumableRedesign: vi.fn(),
  startRedesignDraft: vi.fn(async () => 'draft-new'),
}))

import { startSiteGeneration, SiteGenerationRefused } from '@/lib/site/site-generation'
import { query, queryOne } from '@/lib/shared/db'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { PaidGenerationError, runFreeGeneration, runPaidGeneration } from '@/lib/ai/paid-generation'
import { activeRedesign, claimRedesign, noteRedesignCharge, redesignInDraft, releaseRedesign, resumableRedesign } from '@/lib/site/studio/redesign'

const input = { design: 'keep' as const, colours: 'keep' as const }
const freeClaimCalls = () => vi.mocked(queryOne).mock.calls.filter(c => String(c[0]).includes('INSERT INTO site_settings'))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveTenantId).mockResolvedValue('tenant-1')
  vi.mocked(claimRedesign).mockResolvedValue('run-1')
  vi.mocked(resumableRedesign).mockResolvedValue(null)
  vi.mocked(redesignInDraft).mockResolvedValue({ ok: true, built: 3, total: 3 })
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
})

describe('startSiteGeneration', () => {
  it('refuses while another build holds the store, without taking the free generation', async () => {
    vi.mocked(claimRedesign).mockResolvedValue(null)
    vi.mocked(activeRedesign).mockResolvedValue({ draftId: 'draft-running', ai: {} })
    const err = await startSiteGeneration(input, 'admin-1').catch(e => e)
    expect(err).toBeInstanceOf(SiteGenerationRefused)
    expect(err.body()).toMatchObject({ code: 'busy', draftId: 'draft-running' })
    expect(freeClaimCalls()).toHaveLength(0)
  })

  it('refuses a paid build the owner was not shown as paid, and frees the slot', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    const err = await startSiteGeneration(input, 'admin-1').catch(e => e)
    expect(err).toBeInstanceOf(PaidGenerationError)
    expect(err.code).toBe('price_changed')
    expect(runPaidGeneration).not.toHaveBeenCalled()
    expect(releaseRedesign).toHaveBeenCalledWith('run-1')
  })

  it('runs a paid build on the cap once its price was shown, and notes the charge on the draft', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    const out = await startSiteGeneration(input, 'admin-1', { acceptPaid: true })
    expect(out).toEqual({ draftId: 'draft-new', free: false, capInr: 1500 })
    expect(vi.mocked(runPaidGeneration).mock.calls[0][0]).toMatchObject({ tenantId: 'tenant-1', capInr: 1500, ref: expect.stringMatching(/^site:/) })
    expect(redesignInDraft).toHaveBeenCalledWith('draft-new', input, 'admin-1', expect.objectContaining({ free: false, resume: false }))
    await vi.waitFor(() => expect(releaseRedesign).toHaveBeenCalledWith('run-1'))
    expect(noteRedesignCharge).toHaveBeenCalledWith('draft-new', { free: false, chargedInr: 750, capInr: 1500 })
  })

  it('carries a stopped free build on free, on what is left of its budget, without claiming again', async () => {
    vi.mocked(resumableRedesign).mockResolvedValue({ draftId: 'draft-stopped', freeBudgetInr: 400 })
    const out = await startSiteGeneration(input, 'admin-1', { resume: 'draft-stopped' })
    expect(out).toEqual({ draftId: 'draft-stopped', free: true, capInr: 1500 })
    expect(claimRedesign).toHaveBeenCalledWith('draft-stopped')
    expect(vi.mocked(runFreeGeneration).mock.calls[0][1]).toBe(400)
    expect(freeClaimCalls()).toHaveLength(0)
    expect(redesignInDraft).toHaveBeenCalledWith('draft-stopped', input, 'admin-1', expect.objectContaining({ free: true, resume: true }))
  })

  it('refuses to carry on a build with nothing left', async () => {
    const err = await startSiteGeneration(input, 'admin-1', { resume: 'draft-done' }).catch(e => e)
    expect(err).toBeInstanceOf(SiteGenerationRefused)
    expect(err.code).toBe('not_resumable')
    expect(claimRedesign).not.toHaveBeenCalled()
  })

  it('gives the free generation back when the AI failed before spending anything', async () => {
    vi.mocked(queryOne).mockResolvedValue({ value: 'claim-1' })
    vi.mocked(redesignInDraft).mockResolvedValue({ ok: false, built: 0, total: 0 })
    vi.mocked(runFreeGeneration).mockImplementationOnce(async (_l, _b, fn) => ({ costInr: 0, result: await fn() }) as never)
    const out = await startSiteGeneration(input, 'admin-1')
    expect(out.free).toBe(true)
    expect(vi.mocked(runFreeGeneration).mock.calls[0][1]).toBe(1000)
    await vi.waitFor(() => expect(releaseRedesign).toHaveBeenCalledWith('run-1'))
    expect(vi.mocked(query).mock.calls.some(c => String(c[0]).startsWith('DELETE FROM site_settings') && (c[1] as unknown[])[1] === 'claim-1')).toBe(true)
    expect(noteRedesignCharge).toHaveBeenCalledWith('draft-new', { free: true })
  })
})

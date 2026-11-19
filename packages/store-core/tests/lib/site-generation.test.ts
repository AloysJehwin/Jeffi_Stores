import { describe, it, expect, vi, beforeEach } from 'vitest'

// Site Builder's whole-site redesign: who pays (free, paid after the price was shown, a stopped free build carried on
// free), and the one-build-per-store slot. The build itself (lib/site/studio/redesign.ts) and the wallet runs
// (lib/ai/paid-generation.ts) are stubbed: these tests hold the decision around them.

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/integrations/owner', () => ({ isPlatformOwner: (id: string) => id === 'platform' }))
vi.mock('@/lib/payments/wallet', () => ({ getWalletBalance: vi.fn() }))
vi.mock('@/lib/site/studio/ai', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), STUDIO_BUDGET_INR: () => 1000 }))
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
import type { PageKey } from '@jeffi/site-blocks'
import { checkSection } from '@/lib/site/code/compile'
import { studioLint } from '@/lib/site/studio/lint'
import { specPage } from '@/lib/site/studio/plan'
import type { StudioBrief } from '@/lib/site/studio/types'

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

// The studio's working pages: the plan gives each section a layout that suits its own idea, and the lint flags working
// parts drawn too narrow and carousels whose last card is cut by a sliver.
describe('studio working pages and carousels', () => {
  const lint = (jsx: string, page: PageKey) => {
    const r = checkSection(`export default function S() { return ${jsx} }`, { page })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return studioLint(r.ast, page)
  }
  const narrow = (notes: string[]) => notes.filter(n => / out about .+ on a \d+px-wide screen/.test(n))
  const sliver = (notes: string[]) => notes.filter(n => /cut the last card by a sliver/.test(n))

  it('flags working parts drawn too narrow, and leaves the 7/5 split, a sign-in card and a full-width core alone', () => {
    const steps = '<ContactForm /><AddressForm /><DeliveryOptions /><PaymentStep />'
    expect(narrow(lint(`<section className="mx-auto max-w-6xl px-4"><div className="grid gap-6 lg:grid-cols-3"><div className="flex flex-col gap-4">${steps}</div><OrderSummary /><TrustBadges /></div></section>`, 'checkout'))).toEqual([
      expect.stringMatching(/^<ContactForm>, <AddressForm>, <DeliveryOptions> and <PaymentStep> come out about 331px wide on a 1024px-wide screen, too narrow .* lg:col-span-7/),
    ])
    expect(narrow(lint(`<section className="mx-auto max-w-6xl px-4"><div className="grid gap-8 lg:grid-cols-12"><div className="flex flex-col gap-6 lg:col-span-7">${steps}</div><div className="lg:sticky lg:top-24 lg:col-span-5 lg:self-start"><OrderSummary /></div></div></section>`, 'checkout'))).toEqual([])
    expect(narrow(lint('<section className="grid grid-cols-2 gap-4"><CartLines /><div><CartSummary /><CheckoutButton /></div></section>', 'cart')).join()).toMatch(/<CartLines> comes out about 179px wide on a 390px-wide screen/)
    expect(narrow(lint('<section className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-2"><div className="hidden lg:block"><h1>Welcome back</h1></div><div className="mx-auto w-full max-w-md"><SignInForm /></div></section>', 'login'))).toEqual([])
    expect(narrow(lint('<section className="mx-auto max-w-2xl px-4"><WishlistGrid /></section>', 'wishlist')).join()).toMatch(/<WishlistGrid> comes out about 53% of the page wide \(672px\) on a 1440px-wide screen/)
    expect(narrow(lint('<section className="mx-auto max-w-7xl px-4"><h1>Saved for later</h1><WishlistGrid /></section>', 'wishlist'))).toEqual([])
  })

  it('flags carousel slides that cut the last card by a sliver, and leaves exact widths, a clear peek and short lists alone', () => {
    const notes = sliver(lint('<CartUpsell layout="carousel" itemClassName="w-[88%] sm:w-[48%] md:w-[32%] lg:w-[24%]" />', 'cart'))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/^<CartUpsell>'s carousel slides cut the last card by a sliver: on a 1024px-wide screen, 4 slides of "lg:w-\[24%\]" and their 3 gaps of 20px need about 1012px, but the rail is about 992px wide/)
    expect(notes[0]).toContain('itemClassName="w-[88%] sm:w-[48%] md:w-[calc((100%-2.5rem)/3)] lg:w-[calc((100%-3.75rem)/4)]"')
    expect(sliver(lint('<CartUpsell layout="carousel" itemClassName="w-[88%] sm:w-[48%] md:w-[calc((100%-2.5rem)/3)] lg:w-[calc((100%-3.75rem)/4)]" />', 'cart'))).toEqual([])
    expect(sliver(lint('<Products layout="carousel" itemClassName="w-[80%] sm:w-[42%] md:w-[28%] lg:w-[21%]" />', 'home'))).toEqual([])
    // Three reviews never reach a fourth slide; a <Carousel> of one child has one slide, of three a second one cut.
    expect(sliver(lint('<Reviews layout="carousel" itemClassName="w-[88%] lg:w-[24%]" />', 'home'))).toEqual([])
    expect(sliver(lint('<Carousel itemClassName="w-[88%] lg:w-[52%]"><div><h2>One</h2></div></Carousel>', 'home'))).toEqual([])
    expect(sliver(lint('<Carousel itemClassName="w-[88%] lg:w-[52%]"><div>One</div><div>Two</div><div>Three</div></Carousel>', 'home')).join()).toMatch(
      /^<Carousel>'s slides cut the last card by a sliver: on a 1440px-wide screen, 2 slides of "lg:w-\[52%\]" and their 1 gap of 20px need about 1351px, but the rail is about 1280px wide \(their widths alone add up to more than the rail\)/
    )
  })

  it('plans each fallback section of a working page with a layout that suits its own idea', () => {
    for (let seed = 0; seed < 20; seed++) {
      const b = { seed } as StudioBrief
      const cart = specPage(b, 'store', 'cart')!
      const lines = cart.sections.find(s => s.parts.includes('CartLines'))!
      expect(lines.parts).toEqual(expect.arrayContaining(['CartSummary', 'CheckoutButton']))
      expect(['lines left, a sticky summary right', 'one column with the summary card at the end']).toContain(lines.layout)
      expect(cart.sections.find(s => s.parts.includes('FreeShippingProgress'))?.parts).not.toContain('CartLines')
      expect(specPage(b, 'store', 'checkout')!.sections.find(s => s.parts.includes('PaymentStep'))?.layout).not.toBe('a quiet centred band with three columns')
      expect(specPage(b, 'store', 'product')!.sections.find(s => s.parts.includes('ProductGallery'))?.layout).not.toBe('a full-width band with a centred heading over a card grid')
      for (const page of ['products', 'category', 'brand', 'search'] as const)
        expect(specPage(b, 'store', page)!.sections.find(s => s.parts.includes('ProductResults'))?.layout, page).toBe('filters in a column on the left, the grid on the right')
    }
  })
})

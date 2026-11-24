import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// A Showcase's generate and "Design this page again": the first design free, then a redesign for a flat ₹50 from the
// workspace's wallet, asked for with the price the studio showed. Nothing here reaches the AI.

const m = vi.hoisted(() => ({
  owner: vi.fn(),
  session: vi.fn(),
  claimBuild: vi.fn(),
  claimPaidBuild: vi.fn(),
  aiUp: vi.fn(),
  site: vi.fn(),
  walletTenant: vi.fn(),
  workspace: vi.fn(),
  balance: vi.fn(),
  freeBuild: vi.fn(),
  paidBuild: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: m.aiUp }))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  getStudioSession: m.session,
  buildRunning: (s: { status: string }) => s.status === 'building',
  claimBuild: m.claimBuild,
  claimPaidBuild: m.claimPaidBuild,
  claimRebuild: vi.fn(),
  refundTweaks: vi.fn(),
  spendTweaks: vi.fn(),
}))
vi.mock('@controller/lib/site-studio/build', () => ({ reload: vi.fn().mockResolvedValue(null), runStudioBuild: vi.fn(), runPageRebuild: vi.fn(), FREE_RETRIES: 2 }))
vi.mock('@controller/lib/site-studio/funded', () => ({ freeBudgetLeft: () => 100 }))
vi.mock('@/lib/site/studio', () => ({ CARD_KEY: 'store:card' }))
vi.mock('@/lib/site/themes/catalog', () => ({ themeOfDirection: () => null }))
vi.mock('@controller/lib/showcase-builder/build', () => ({ runShowcaseBuild: m.freeBuild, runShowcasePaidBuild: m.paidBuild, WALLET_URL: '/dashboard/wallet' }))
vi.mock('@controller/lib/showcase-builder/site', () => ({ sessionShowcase: m.site }))
vi.mock('@controller/lib/showcase/billing', () => ({ showcaseWalletTenant: m.walletTenant }))
vi.mock('@/lib/showcase/workspace', () => ({ ensureShowcaseWorkspace: m.workspace }))
vi.mock('@/lib/payments/wallet', () => ({ getWalletBalance: m.balance, isFlagshipTenant: (id: string) => id === '00000000-0000-0000-0000-000000000000' }))

import { POST as generate } from '@controller/app/api/(ecom)/ecom/onboard/studio/generate/route'
import { POST as regenerate } from '@controller/app/api/(ecom)/ecom/onboard/studio/regenerate-page/route'

const TENANT = '11111111-1111-1111-1111-111111111111'
const SITE = { id: 'site-1', ownerId: 'o-1', slug: 'lens', tenantId: null, status: 'draft', business: { name: 'Lens' } }
const HOUR_AGO = new Date(Date.now() - 3600_000).toISOString()
/** A Showcase whose free design is done: the next one is a redesign. */
const designed = (over: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  product: 'showcase',
  status: 'ready',
  direction: { id: 'd' },
  plan: { pages: [{ key: 'showcase:home' }] },
  pages: { 'showcase:home': { order: ['b1'] } },
  free_used_at: HOUR_AGO,
  generated_at: HOUR_AGO,
  spent_inr: 40,
  tweaks_today: 0,
  tweaks_day: null,
  updated_at: HOUR_AGO,
  ...over,
})

const post = (route: (r: NextRequest) => Promise<Response>, path: string, body: object) =>
  route(new NextRequest(`http://ecom.localhost/api/ecom/onboard/studio/${path}?product=showcase`, { method: 'POST', body: JSON.stringify(body) }))
const json = async (res: Response) => ({ status: res.status, body: await res.json() })

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue(designed())
  m.aiUp.mockResolvedValue(true)
  m.site.mockResolvedValue(SITE)
  m.walletTenant.mockResolvedValue(TENANT)
  m.workspace.mockResolvedValue(null)
  m.balance.mockResolvedValue({ balance: 500, minBalance: 0, currency: 'INR' })
  m.claimBuild.mockImplementation(async (id: string) => ({ ...designed(), id, status: 'building' }))
  m.claimPaidBuild.mockImplementation(async (id: string) => ({ ...designed(), id, status: 'building' }))
  m.freeBuild.mockResolvedValue(null)
  m.paidBuild.mockResolvedValue({ session: null, chargedInr: 50 })
})

describe('POST /api/ecom/onboard/studio/generate (a Showcase redesign)', () => {
  it('asks for the ₹50 first: without expect it is a 409 price_changed, and nothing is read or run', async () => {
    const r = await json(await post(generate, 'generate', {}))
    expect(r).toEqual({ status: 409, body: { error: 'Your free design is used. Designing your page again costs ₹50 from your wallet.', code: 'price_changed', priceInr: 50 } })
    expect(m.balance).not.toHaveBeenCalled()
    expect(m.claimPaidBuild).not.toHaveBeenCalled()
  })

  it('refuses a price the owner was not shown', async () => {
    const r = await json(await post(generate, 'generate', { expect: 'paid', priceInr: 100 }))
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'price_changed', priceInr: 50 })
    expect(m.claimPaidBuild).not.toHaveBeenCalled()
  })

  it('tells a wallet below ₹50 what to add and where, before anything runs', async () => {
    m.balance.mockResolvedValue({ balance: 40, minBalance: 0, currency: 'INR' })
    const r = await json(await post(generate, 'generate', { expect: 'paid', priceInr: 50 }))
    expect(r).toEqual({
      status: 402,
      body: {
        error: 'Add ₹10 to your wallet to design your page again. A redesign costs ₹50; your wallet has ₹40.',
        code: 'wallet_low',
        balanceInr: 40,
        minBalanceInr: 0,
        neededInr: 10,
        priceInr: 50,
        topUpUrl: '/dashboard/wallet',
      },
    })
    expect(m.balance).toHaveBeenCalledWith(TENANT)
    expect(m.claimPaidBuild).not.toHaveBeenCalled()
    expect(m.paidBuild).not.toHaveBeenCalled()
  })

  it('keeps the wallet’s minimum balance, and says so', async () => {
    m.balance.mockResolvedValue({ balance: 120, minBalance: 100, currency: 'INR' })
    const r = await json(await post(generate, 'generate', { expect: 'paid', priceInr: 50 }))
    expect(r.status).toBe(402)
    expect(r.body).toMatchObject({ neededInr: 30, minBalanceInr: 100 })
    expect(r.body.error).toBe('Add ₹30 to your wallet to design your page again. A redesign costs ₹50; your wallet has ₹120, and keeps ₹100 as its minimum balance.')
  })

  it('starts the redesign with exactly ₹50 in the wallet, paid by the site’s workspace', async () => {
    m.balance.mockResolvedValue({ balance: 50, minBalance: 0, currency: 'INR' })
    const res = await post(generate, 'generate', { expect: 'paid', priceInr: 50 })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(await res.text()).toContain('event: done')
    expect(m.claimPaidBuild).toHaveBeenCalledWith('sess-1')
    expect(m.paidBuild).toHaveBeenCalledWith(expect.objectContaining({ id: 'sess-1' }), expect.objectContaining({ id: 'site-1', tenantId: TENANT }), expect.any(Function))
    expect(m.freeBuild).not.toHaveBeenCalled()
  })

  it('accepts a studio that confirmed the older range without sending a price', async () => {
    const res = await post(generate, 'generate', { expect: 'paid' })
    expect(res.status).toBe(200)
    await res.text()
    expect(m.paidBuild).toHaveBeenCalledTimes(1)
  })

  it('gives a draft without a workspace the one it would get on publishing, else says to try again with no top-up link', async () => {
    m.walletTenant.mockResolvedValue(null)
    m.workspace.mockResolvedValue(TENANT)
    const ok = await post(generate, 'generate', { expect: 'paid', priceInr: 50 })
    await ok.text()
    expect(m.workspace).toHaveBeenCalledWith(SITE)
    expect(m.paidBuild).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: TENANT }), expect.any(Function))

    m.workspace.mockResolvedValue(null)
    const r = await json(await post(generate, 'generate', { expect: 'paid', priceInr: 50 }))
    expect(r.status).toBe(402)
    expect(r.body).toMatchObject({ code: 'wallet_low', priceInr: 50, topUpUrl: null })
  })

  it('never asks the platform’s own workspace to top up', async () => {
    m.walletTenant.mockResolvedValue('00000000-0000-0000-0000-000000000000')
    const res = await post(generate, 'generate', { expect: 'paid', priceInr: 50 })
    await res.text()
    expect(m.balance).not.toHaveBeenCalled()
    expect(m.paidBuild).toHaveBeenCalledTimes(1)
  })

  it('says so when Claude is unreachable, before any price or wallet', async () => {
    m.aiUp.mockResolvedValue(false)
    const r = await json(await post(generate, 'generate', { expect: 'paid', priceInr: 50 }))
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('ai_unavailable')
    expect(m.balance).not.toHaveBeenCalled()
  })
})

describe('the free design', () => {
  it('runs free while it is unused, never touching the wallet', async () => {
    m.session.mockResolvedValue(designed({ free_used_at: null, generated_at: null, spent_inr: 0 }))
    const res = await post(generate, 'generate', {})
    await res.text()
    expect(m.claimBuild).toHaveBeenCalledWith('sess-1')
    expect(m.freeBuild).toHaveBeenCalledTimes(1)
    expect(m.balance).not.toHaveBeenCalled()
    expect(m.paidBuild).not.toHaveBeenCalled()
  })

  it('stays free after one that failed (claimed, never generated), so it is not charged', async () => {
    m.session.mockResolvedValue(designed({ status: 'failed', generated_at: null, spent_inr: 12 }))
    const res = await post(generate, 'generate', {})
    await res.text()
    expect(m.freeBuild).toHaveBeenCalledTimes(1)
    expect(m.paidBuild).not.toHaveBeenCalled()
    expect(m.balance).not.toHaveBeenCalled()
  })

  it('answers with the ₹50 when another tab used it first', async () => {
    m.session.mockResolvedValue(designed({ free_used_at: null, generated_at: null, spent_inr: 0 }))
    m.claimBuild.mockResolvedValue(null)
    const r = await json(await post(generate, 'generate', {}))
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'price_changed', priceInr: 50 })
  })
})

describe('POST /api/ecom/onboard/studio/regenerate-page ("Design this page again")', () => {
  it('is the same redesign: priced, checked against the wallet, then run', async () => {
    const asked = await json(await post(regenerate, 'regenerate-page', { page: 'showcase:home' }))
    expect(asked).toMatchObject({ status: 409, body: { code: 'price_changed', priceInr: 50 } })

    m.balance.mockResolvedValue({ balance: 0, minBalance: 0, currency: 'INR' })
    const short = await json(await post(regenerate, 'regenerate-page', { page: 'showcase:home', expect: 'paid', priceInr: 50 }))
    expect(short).toMatchObject({ status: 402, body: { code: 'wallet_low', neededInr: 50, topUpUrl: '/dashboard/wallet' } })

    m.balance.mockResolvedValue({ balance: 75, minBalance: 0, currency: 'INR' })
    const res = await post(regenerate, 'regenerate-page', { page: 'showcase:home', expect: 'paid', priceInr: 50 })
    await res.text()
    expect(m.paidBuild).toHaveBeenCalledTimes(1)
  })
})

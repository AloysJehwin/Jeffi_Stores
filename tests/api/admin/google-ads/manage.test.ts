import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  runAction: vi.fn(),
  createCampaign: vi.fn(),
  linkStatus: vi.fn(),
  writeAdCopy: vi.fn(),
  listAdsChanges: vi.fn(),
  bootstrap: vi.fn(),
  itemIds: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn(async () => ({ customerId: '1234567890' })) }))
vi.mock('@/lib/google-ads/actions', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/actions')
  return { ...actual, runAction: m.runAction }
})
vi.mock('@/lib/google-ads/campaigns', () => ({ createCampaign: m.createCampaign, loadCampaignSettings: vi.fn() }))
vi.mock('@/lib/google-ads/merchant-link', () => ({ merchantLinkStatus: m.linkStatus, linkMerchantCenter: vi.fn() }))
vi.mock('@/lib/google-ads/ad-copy', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/ad-copy')
  return { ...actual, writeAdCopy: m.writeAdCopy }
})
vi.mock('@/lib/google-ads/mutate', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/mutate')
  return { ...actual, listAdsChanges: m.listAdsChanges }
})
vi.mock('@/lib/google-ads/manage-data', () => ({ loadWizardBootstrap: m.bootstrap }))
vi.mock('@/lib/google-ads/listing', () => ({ itemIdsForCategories: m.itemIds }))
vi.mock('@/lib/google-ads/assets', () => ({ prepareImages: vi.fn(), assetSuggestions: vi.fn() }))

import { GET as bootstrap, POST as action } from '@/app/api/(admin)/admin/google-ads/manage/route'
import { POST as create } from '@/app/api/(admin)/admin/google-ads/manage/campaigns/route'
import { POST as aiCopy } from '@/app/api/(admin)/admin/google-ads/manage/ai-copy/route'
import { GET as changeLog } from '@/app/api/(admin)/admin/google-ads/manage/change-log/route'
import { AdsMutationError } from '@/lib/google-ads/mutate'

const PRO_ADMIN = { adminId: 'a1', email: 'owner@store.in', role: 'super_admin', scopes: ['google_ads_campaigns:write', 'google_ads:read', 'catalog_enrichment:write'] }
const post = (url: string, body: unknown) => new NextRequest(`https://acme.jeffistores.in${url}`, { method: 'POST', body: JSON.stringify(body) })
const searchSpec = {
  type: 'SEARCH',
  name: 'Drills',
  dailyBudget: 400,
  bidding: { strategy: 'MAXIMIZE_CONVERSIONS' },
  locations: [{ id: 'geoTargetConstants/2356', name: 'India' }],
  languages: ['languageConstants/1000'],
  adGroups: [
    {
      name: 'Drills',
      keywords: [{ text: 'drill', matchType: 'EXACT' }],
      ad: { headlines: ['One', 'Two', 'Three'], descriptions: ['First line.', 'Second line.'], finalUrl: 'https://acme.in' },
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(PRO_ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
})

describe('plan and scope gating', () => {
  it('requires google_ads_campaigns:write on every management route', async () => {
    m.bootstrap.mockResolvedValue({ ok: 1 })
    await bootstrap(new NextRequest('https://x/api/admin/google-ads/manage'))
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads_campaigns:write')
    expect(m.planGate).toHaveBeenCalledWith('google_ads_campaigns:write')
  })

  it('is closed to a Growth tenant even if a stale session carries the scope', async () => {
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await action(post('/api/admin/google-ads/manage', { action: 'campaign.status', campaignId: '1', status: 'PAUSED' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro', error: expect.stringContaining('Pro plan') })
    expect(m.runAction).not.toHaveBeenCalled()
  })

  it('passes through the scope check failure', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await create(post('/api/admin/google-ads/manage/campaigns', { spec: searchSpec }))
    expect(res.status).toBe(403)
    expect(m.createCampaign).not.toHaveBeenCalled()
  })

  it('lets reporting users read the change log', async () => {
    m.listAdsChanges.mockResolvedValue([{ id: '1', summary: 'Paused campaign' }])
    const res = await changeLog(new NextRequest('https://x/api/admin/google-ads/manage/change-log'))
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
    expect((await res.json()).changes).toHaveLength(1)
  })
})

describe('edit actions', () => {
  it('validates the body before calling Google', async () => {
    const res = await action(post('/api/admin/google-ads/manage', { action: 'campaign.status', campaignId: '1; DROP', status: 'PAUSED' }))
    expect(res.status).toBe(400)
    expect(m.runAction).not.toHaveBeenCalled()
  })

  it('runs the action as the signed-in admin, with preview when asked', async () => {
    m.runAction.mockResolvedValue({ ok: true, preview: true, summary: 'Paused campaign "X"', resourceNames: [], refreshError: null })
    const res = await action(post('/api/admin/google-ads/manage', { action: 'campaign.status', campaignId: '55', status: 'PAUSED', preview: true }))
    expect(res.status).toBe(200)
    expect(m.runAction).toHaveBeenCalledWith({ action: 'campaign.status', campaignId: '55', status: 'PAUSED' }, { customerId: '1234567890' }, { adminId: 'a1', email: 'owner@store.in' }, true)
  })

  it('returns Google problems readable', async () => {
    m.runAction.mockRejectedValue(new AdsMutationError('Budget: Too low.', 'validate', [{ message: 'Too low.', code: 'TOO_LOW', where: 'Budget' }], 400))
    const res = await action(post('/api/admin/google-ads/manage', { action: 'campaign.budget', campaignId: '55', dailyBudget: 1 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Budget: Too low.', stage: 'validate', problems: [{ code: 'TOO_LOW' }] })
  })
})

describe('campaign creation', () => {
  it('rejects a spec with problems before calling Google', async () => {
    const res = await create(post('/api/admin/google-ads/manage/campaigns', { spec: { ...searchSpec, locations: [] } }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Choose at least one location')
    expect(m.createCampaign).not.toHaveBeenCalled()
  })

  it('previews a Search campaign without needing Merchant Center', async () => {
    m.createCampaign.mockResolvedValue({ operations: { campaignOperation: 1 }, followUps: [] })
    const res = await create(post('/api/admin/google-ads/manage/campaigns', { spec: searchSpec, preview: true }))
    expect(res.status).toBe(200)
    expect(m.linkStatus).not.toHaveBeenCalled()
    const [spec, ctx, actor, opts] = m.createCampaign.mock.calls[0]
    expect(spec.name).toBe('Drills')
    expect(ctx).toMatchObject({ customerId: '1234567890', merchantId: null })
    expect(actor).toEqual({ adminId: 'a1', email: 'owner@store.in' })
    expect(opts.preview).toBe(true)
  })

  it('needs a linked Merchant Center for Shopping', async () => {
    m.linkStatus.mockResolvedValue({ merchantId: '42', linked: false, linkedIds: [], pending: [] })
    const shopping = { ...searchSpec, type: 'SHOPPING', bidding: { strategy: 'MAXIMIZE_CONVERSION_VALUE' }, adGroups: undefined, listing: { dimension: 'ALL', values: [] } }
    const res = await create(post('/api/admin/google-ads/manage/campaigns', { spec: shopping }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Link your Merchant Center/)
  })

  it('resolves category product groups to feed item ids', async () => {
    m.linkStatus.mockResolvedValue({ merchantId: '42', linked: true, linkedIds: ['42'], pending: [] })
    m.itemIds.mockResolvedValue(['tw-001', 'tw-002'])
    m.createCampaign.mockResolvedValue({ campaignId: '9', resourceNames: [], steps: [], refreshError: null })
    const shopping = {
      ...searchSpec,
      type: 'SHOPPING',
      bidding: { strategy: 'MAXIMIZE_CONVERSION_VALUE' },
      adGroups: undefined,
      listing: { dimension: 'CATEGORY', values: ['4dc8105c-97b9-460a-844a-6057319b0334'] },
    }
    const res = await create(post('/api/admin/google-ads/manage/campaigns', { spec: shopping }))
    expect(res.status).toBe(200)
    expect(m.itemIds).toHaveBeenCalledWith(['4dc8105c-97b9-460a-844a-6057319b0334'])
    expect(m.createCampaign.mock.calls[0][1]).toMatchObject({ merchantId: '42', listing: { dimension: 'CATEGORY', values: ['tw-001', 'tw-002'] } })
  })
})

describe('Write with AI', () => {
  it('is denied without the AI plan feature', async () => {
    m.requireAdminScope.mockResolvedValue({ ...PRO_ADMIN, scopes: ['google_ads_campaigns:write'] })
    const res = await aiCopy(post('/api/admin/google-ads/manage/ai-copy', { kind: 'rsa' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/AI tools are not available/)
    expect(m.writeAdCopy).not.toHaveBeenCalled()
  })

  it('writes copy for an allowed admin', async () => {
    m.writeAdCopy.mockResolvedValue({ kind: 'callouts', callouts: ['Free delivery'], dropped: 0 })
    const res = await aiCopy(post('/api/admin/google-ads/manage/ai-copy', { kind: 'callouts', context: { facts: ['Cash on delivery'] } }))
    expect(res.status).toBe(200)
    expect(m.writeAdCopy).toHaveBeenCalledWith('callouts', { facts: ['Cash on delivery'] })
  })

  it('rejects unknown copy kinds', async () => {
    expect((await aiCopy(post('/api/admin/google-ads/manage/ai-copy', { kind: 'essay' }))).status).toBe(400)
  })
})

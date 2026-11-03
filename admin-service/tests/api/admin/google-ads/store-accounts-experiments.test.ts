import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  authenticateAdmin: vi.fn(),
  planGate: vi.fn(),
  managerClient: vi.fn(),
  saveAdsConfig: vi.fn(),
  status: vi.fn(),
  createStoreAccount: vi.fn(),
  createExperiment: vi.fn(),
  experimentAction: vi.fn(),
  createCampaign: vi.fn(),
  dgMin: vi.fn(),
  prepareImages: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope, authenticateAdmin: m.authenticateAdmin }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: m.audit }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(async () => ({ c: 'INR' })), queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/google-ads/credentials', () => ({
  adsTenantKey: vi.fn(async () => 'tenant-1'),
  managerClient: m.managerClient,
  saveAdsConfig: m.saveAdsConfig,
  googleAdsClientFor: vi.fn(async () => ({ customerId: '1234567890' })),
}))
vi.mock('@/lib/google-ads/connection', () => ({ getAdsConnectionStatus: m.status }))
vi.mock('@/lib/google-ads/account-create', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/account-create')
  return { ...actual, createStoreAccount: m.createStoreAccount }
})
vi.mock('@/lib/google-ads/experiments', () => ({ createExperiment: m.createExperiment, experimentAction: m.experimentAction, loadExperiments: vi.fn(), refreshExperiments: vi.fn() }))
vi.mock('@/lib/google-ads/campaigns', () => ({ createCampaign: m.createCampaign }))
vi.mock('@/lib/google-ads/image-ads', () => ({ demandGenMinimumDaily: m.dgMin, listAudiences: vi.fn(async () => []) }))
vi.mock('@/lib/google-ads/assets', () => ({ prepareImages: m.prepareImages }))
vi.mock('@/lib/google-ads/merchant-link', () => ({ merchantLinkStatus: vi.fn() }))
vi.mock('@/lib/google-ads/listing', () => ({ itemIdsForCategories: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getSiteControls: vi.fn(async () => ({ identity: { logoUrl: 'https://cdn/logo.png' } })) }))

import { POST as createAccount } from '@admin/app/api/(admin)/admin/google-ads/account/route'
import { POST as newExperiment } from '@admin/app/api/(admin)/admin/google-ads/manage/experiments/route'
import { POST as experimentAct } from '@admin/app/api/(admin)/admin/google-ads/manage/experiments/[id]/route'
import { POST as createCampaignRoute } from '@admin/app/api/(admin)/admin/google-ads/manage/campaigns/route'

const ADMIN = { adminId: 'a1', email: 'owner@store.in', role: 'super_admin', scopes: ['google_ads:write', 'google_ads_campaigns:write'] }
const post = (url: string, body: unknown) => new NextRequest(`https://acme.jeffistores.in${url}`, { method: 'POST', body: JSON.stringify(body) })
const MGR = { customerId: '9998887776' }

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.managerClient.mockReturnValue(MGR)
  m.status.mockResolvedValue({ connected: false, connectedVia: null, customerId: null })
})

describe('create a store account', () => {
  it('needs google_ads:write and the Pro plan', async () => {
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await createAccount(post('/api/admin/google-ads/account', { name: 'Acme' }))
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect(m.planGate).toHaveBeenCalledWith('google_ads_campaigns:write')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro', error: 'Creating a Google Ads account needs the Pro plan.' })
    expect(m.createStoreAccount).not.toHaveBeenCalled()
  })

  it('refuses when the store is already connected or the manager is not configured', async () => {
    m.status.mockResolvedValueOnce({ connected: true, connectedVia: 'oauth', customerId: '1234567890' })
    expect((await createAccount(post('/api/admin/google-ads/account', { name: 'Acme' }))).status).toBe(409)
    m.managerClient.mockReturnValueOnce(null)
    expect((await createAccount(post('/api/admin/google-ads/account', { name: 'Acme' }))).status).toBe(503)
    expect(m.createStoreAccount).not.toHaveBeenCalled()
  })

  it('creates the account and saves a manager-mode connection for this store', async () => {
    m.createStoreAccount.mockResolvedValue({ customerId: '1112223334', name: 'Acme', invitation: { email: 'o@a.in', sent: true, error: null } })
    const res = await createAccount(post('/api/admin/google-ads/account', { name: 'Acme', inviteEmail: 'o@a.in' }))
    expect(res.status).toBe(200)
    expect(m.createStoreAccount).toHaveBeenCalledWith(MGR, { name: 'Acme', inviteEmail: 'o@a.in' }, { preview: undefined })
    expect(m.saveAdsConfig).toHaveBeenCalledWith('tenant-1', { customer_id: '1112223334', connected_via: 'manager' }, expect.objectContaining({ created_by_platform: true, invited_email: 'o@a.in' }))
    const body = await res.json()
    expect(body).toMatchObject({ customerId: '1112223334', currency: 'INR', timeZone: 'Asia/Kolkata', billingUrl: expect.stringContaining('billing') })
    expect(m.audit).toHaveBeenCalled()
  })
})

describe('experiments', () => {
  const spec = { campaignId: '901', name: 'Test', trafficSplit: 50, change: { strategy: 'MAXIMIZE_CLICKS' } }

  it('needs campaign management on Pro and up', async () => {
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await newExperiment(post('/api/admin/google-ads/manage/experiments', { spec }))
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads_campaigns:write')
    expect(res.status).toBe(403)
    expect(m.createExperiment).not.toHaveBeenCalled()
    const act = await experimentAct(post('/api/admin/google-ads/manage/experiments/700', { action: 'end' }), { params: Promise.resolve({ id: '700' }) })
    expect(act.status).toBe(403)
  })

  it('validates the body and passes preview through', async () => {
    expect((await newExperiment(post('/api/admin/google-ads/manage/experiments', { spec: { ...spec, trafficSplit: 100 } }))).status).toBe(400)
    m.createExperiment.mockResolvedValue({ preview: true })
    const res = await newExperiment(post('/api/admin/google-ads/manage/experiments', { spec, preview: true }))
    expect(res.status).toBe(200)
    expect(m.createExperiment).toHaveBeenCalledWith(expect.objectContaining({ campaignId: '901' }), { customerId: '1234567890' }, { adminId: 'a1', email: 'owner@store.in' }, { preview: true })
    m.experimentAction.mockResolvedValue({ ok: true, preview: false, summary: 'Ended' })
    const act = await experimentAct(post('/api/admin/google-ads/manage/experiments/700', { action: 'graduate', dailyBudget: 300 }), { params: Promise.resolve({ id: '700' }) })
    expect(act.status).toBe(200)
    expect(m.experimentAction).toHaveBeenCalledWith('700', 'graduate', { customerId: '1234567890' }, expect.anything(), { dailyBudget: 300, preview: undefined })
    expect((await experimentAct(post('/x', { action: 'end' }), { params: Promise.resolve({ id: 'abc' }) })).status).toBe(400)
  })
})

describe('Demand Gen create', () => {
  const dg = {
    type: 'DEMAND_GEN',
    name: 'DG',
    dailyBudget: 300,
    bidding: { strategy: 'MAXIMIZE_CONVERSIONS' },
    locations: [{ id: 'geoTargetConstants/2356', name: 'India' }],
    languages: ['languageConstants/1000'],
    imageAd: { finalUrl: 'https://acme.in', headlines: ['A'], descriptions: ['B'], businessName: 'Acme', imageIds: ['11111111-2222-3333-4444-555555555555'] },
  }

  it("rejects a budget below Google's minimum before creating anything", async () => {
    m.dgMin.mockResolvedValue(450)
    const res = await createCampaignRoute(post('/api/admin/google-ads/manage/campaigns', { spec: dg }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('at least 450')
    expect(m.createCampaign).not.toHaveBeenCalled()
  })

  it('prepares portrait images and the logo, without Merchant Center', async () => {
    m.dgMin.mockResolvedValue(250)
    m.prepareImages.mockResolvedValue({ landscape: ['l'], square: ['s'], portrait: ['p'], logo: 'g' })
    m.createCampaign.mockResolvedValue({ campaignId: '55' })
    const res = await createCampaignRoute(post('/api/admin/google-ads/manage/campaigns', { spec: dg }))
    expect(res.status).toBe(200)
    expect(m.prepareImages).toHaveBeenCalledWith(dg.imageAd.imageIds, 'https://cdn/logo.png', undefined, { portrait: true })
    expect(m.createCampaign.mock.calls[0][1]).toMatchObject({ merchantId: null, images: { portrait: ['p'] } })
  })
})

it('scope check failure passes through', async () => {
  m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
  expect((await createAccount(post('/api/admin/google-ads/account', { name: 'A' }))).status).toBe(403)
})

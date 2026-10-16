import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryOne, planGate, auditAdmin, clientFor, refreshMirror, callInternalApi } = vi.hoisted(() => ({
  queryOne: vi.fn(),
  planGate: vi.fn(),
  auditAdmin: vi.fn(),
  clientFor: vi.fn(),
  refreshMirror: vi.fn(),
  callInternalApi: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ queryOne, queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: planGate }))
vi.mock('@/lib/auth/audit-context', () => ({ getCurrentAuditAdminId: auditAdmin }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: clientFor }))
vi.mock('@/lib/google-ads/refresh', () => ({ refreshMirror }))
vi.mock('@/app/api/(admin)/admin/agent/actions/[id]/approve/_lib/shared', () => ({ callInternalApi }))

import { GoogleAdsClient } from '@/lib/google-ads/client'
import { GOOGLE_ADS_TOOLS, adsGate } from '@/lib/admin-agent/tools/google-ads'
import { getTool, TOOLS } from '@/lib/admin-agent/tools'
import { executeAction } from '@/app/api/(admin)/admin/agent/actions/[id]/approve/_lib/execute'

const CID = '1234567890'
const fetchMock = vi.fn()
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
const tool = (name: string) => GOOGLE_ADS_TOOLS.find(t => t.name === name)!
let admin: { role: string; scopes: string[] } | null

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  auditAdmin.mockReturnValue('00000000-0000-4000-8000-000000000009')
  admin = { role: 'staff', scopes: ['google_ads_campaigns:write'] }
  clientFor.mockResolvedValue(
    new GoogleAdsClient({ refreshToken: 'r', customerId: CID, developerToken: 'd', fetchImpl: fetchMock as any, retryDelays: [], getAccessToken: async () => ({ token: 't', expiresInSec: 3600 }) })
  )
  queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM admins')) return admin
    if (sql.includes('FROM ads_campaigns')) return { campaign_id: '55', name: 'Drills', status: 'ENABLED', budget_amount_micros: '500000000', channel_type: 'SEARCH' }
    return null
  })
})

describe('registration', () => {
  it('registers the read and propose tools; only propose_* mutate', () => {
    for (const t of GOOGLE_ADS_TOOLS) expect(getTool(t.name)).toBe(t)
    expect(GOOGLE_ADS_TOOLS.filter(t => t.mutating).map(t => t.name)).toEqual(['propose_pause_campaign', 'propose_budget_change', 'propose_add_negative_keyword'])
    expect(new Set(TOOLS.map(t => t.name)).size).toBe(TOOLS.length)
  })
})

describe('gating', () => {
  it('needs the plan and, for staff, the scope; owners follow the plan', async () => {
    expect(await adsGate('google_ads_campaigns:write')).toBeNull()
    admin = { role: 'staff', scopes: ['google_ads:read'] }
    expect(await adsGate('google_ads_campaigns:write')).toMatch(/permission/)
    admin = { role: 'super_admin', scopes: [] }
    expect(await adsGate('google_ads_campaigns:write')).toBeNull()
    planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect(await adsGate('google_ads_campaigns:write')).toBe('Managing Google Ads campaigns needs the Pro plan.')
  })

  it('refuses a proposal without permission and never calls Google', async () => {
    admin = { role: 'staff', scopes: ['google_ads:read'] }
    const out: any = await tool('propose_pause_campaign').handler({ campaignName: 'drill' })
    expect(out.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('proposal -> approval', () => {
  it('validates the pause with Google only, then the approved action goes through the manage endpoint', async () => {
    fetchMock.mockResolvedValueOnce(json({}))
    const out: any = await tool('propose_pause_campaign').handler({ campaignName: 'drill' })
    expect(out).toMatchObject({
      proposed: true,
      kind: 'google_ads_action',
      payload: { body: { action: 'campaign.status', campaignId: '55', status: 'PAUSED' }, summary: 'Paused campaign "Drills"' },
      confirmation: 'Pause Google Ads campaign "Drills"?',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).validateOnly).toBe(true)

    callInternalApi.mockResolvedValue({ ok: true, status: 200, data: { summary: 'Paused campaign "Drills"', refreshError: null } })
    const r = await executeAction({ id: 'a', admin_id: 'x', conversation_id: 'c', kind: 'google_ads_action', payload: out.payload, status: 'approved' }, 'sid=1')
    expect(r).toEqual({ result: { summary: 'Paused campaign "Drills"', refreshError: null }, error: null })
    expect(callInternalApi).toHaveBeenCalledWith('sid=1', 'POST', '/api/admin/google-ads/manage', { action: 'campaign.status', campaignId: '55', status: 'PAUSED', preview: false })
  })

  it('proposes a budget change and a negative keyword', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('searchStream')
        ? json([{ results: [{ campaign: { id: '55', name: 'Drills', biddingStrategyType: 'MANUAL_CPC', campaignBudget: `customers/${CID}/campaignBudgets/1` }, campaignBudget: { amountMicros: '500000000', explicitlyShared: false, referenceCount: 1 } }] }])
        : json({})
    )
    const budget: any = await tool('propose_budget_change').handler({ campaignId: '55', dailyBudget: 800 })
    expect(budget.payload.body).toEqual({ action: 'campaign.budget', campaignId: '55', dailyBudget: 800 })
    const neg: any = await tool('propose_add_negative_keyword').handler({ campaignName: 'Drills', text: 'free drills' })
    expect(neg.payload.body).toEqual({ action: 'negative.add', level: 'campaign', campaignId: '55', text: 'free drills', matchType: 'EXACT' })
    expect(neg.confirmation).toBe('Add negative keyword "free drills" (exact) to "Drills"?')
  })

  it('reports a change Google would reject instead of proposing it', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad', details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure', errors: [{ errorCode: { campaignError: 'CANNOT_MODIFY' }, message: 'Cannot modify' }] }] } }), { status: 400 })
    )
    const out: any = await tool('propose_pause_campaign').handler({ campaignId: '55' })
    expect(out.ok).toBe(false)
    expect(out.summary).toMatch(/would reject this change: Cannot modify/)
  })

  it('refuses unsupported actions on approval', async () => {
    const r = await executeAction({ id: 'a', admin_id: 'x', conversation_id: 'c', kind: 'google_ads_action', payload: { body: { action: 'campaign.remove', campaignId: '55' } }, status: 'approved' }, '')
    expect(r.error).toBe('Unsupported Google Ads change')
    expect(callInternalApi).not.toHaveBeenCalled()
  })
})

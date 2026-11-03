import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))

import { purchaseOf, mapInsight } from '@/lib/meta-ads/sync'
import { buildPurchaseEvent, normPhone, normEmail, sha256, type CapiOrder } from '@/lib/meta-ads/capi'
import { kpis, budgetProblems, MadsActionSchema } from '@/lib/meta-ads/console'
import { evaluateMads, MADS_DEFAULTS, type MadsSnapshot } from '@/lib/meta-ads/alerts'
import { metaClickIds } from '@/lib/shared/attribution'

describe('insights', () => {
  it('takes one purchase action type (they overlap) and link clicks', () => {
    const row = {
      date_start: '2026-10-10', ad_id: '1', adset_id: '2', campaign_id: '3', impressions: '1000', reach: '800', clicks: '40', spend: '250.5',
      actions: [{ action_type: 'link_click', value: '30' }, { action_type: 'omni_purchase', value: '3' }, { action_type: 'purchase', value: '3' }],
      action_values: [{ action_type: 'omni_purchase', value: '4500' }],
    }
    expect(purchaseOf(row)).toEqual({ purchases: 3, value: 4500 })
    expect(mapInsight(row)).toEqual(['2026-10-10', '1', '2', '3', 1000, 800, 40, 30, 250.5, 3, 4500])
  })
  it('computes true ratios', () => {
    expect(kpis({ spend: 100, purchases: 2, purchase_value: 500, link_clicks: 50, impressions: 1000 })).toMatchObject({ roas: 5, cpa: 50, cpc: 2, ctr: 0.05 })
  })
})

describe('Conversions API', () => {
  const order = (o: Partial<CapiOrder> = {}): CapiOrder => ({
    id: 'o1', order_number: 'ORD-1', total_amount: '1180', created_at: '2026-10-16T08:00:00Z', paid_at: null, customer_email: ' Buyer@Mail.com ', customer_phone: '98765 43210',
    ads_consent: true, meta_click_ids: { fbp: 'fb.1.1.2', fbc: 'fb.1.3.abc' }, items: [{ sku: 'S1', quantity: 2, price: 590 }], ...o,
  })
  it('normalises email and Indian phone numbers before hashing', () => {
    expect(normEmail(' A@B.in ')).toBe('a@b.in')
    expect(normPhone('98765 43210')).toBe('919876543210')
    expect(normPhone('+91 98765-43210')).toBe('919876543210')
    expect(normPhone('123')).toBeNull()
  })
  it('sends hashed email and phone only with consent, nothing when refused', () => {
    const full = buildPurchaseEvent(order(), 'https://shop.in')
    expect(full.matched).toEqual(['fbp', 'fbc', 'em', 'ph'])
    expect((full.event as any).user_data.em).toEqual([sha256('buyer@mail.com')])
    expect(full.event).toMatchObject({ event_name: 'Purchase', event_id: 'o1', custom_data: { value: 1180, currency: 'INR', num_items: 2, content_ids: ['S1'] } })
    const noChoice = buildPurchaseEvent(order({ ads_consent: null }), '')
    expect(noChoice.matched).toEqual(['fbp', 'fbc'])
    expect((noChoice.event as any).user_data.em).toBeUndefined()
    expect(buildPurchaseEvent(order({ ads_consent: false }), '').event).toBeNull()
    expect(buildPurchaseEvent(order({ ads_consent: null, meta_click_ids: null }), '').event).toBeNull()
  })
  it('reads _fbp/_fbc and rebuilds fbc from a stored fbclid', () => {
    expect(metaClickIds('_fbp=fb.1.9.9; other=1; _fbc=fb.1.5.x', null)).toEqual({ fbp: 'fb.1.9.9', fbc: 'fb.1.5.x' })
    expect(metaClickIds('', { landing_path: '/', ts: 1700, fbclid: 'abc' })).toEqual({ fbc: 'fb.1.1700.abc' })
    expect(metaClickIds('', null)).toBeNull()
  })
})

describe('Meta Ads changes and alerts', () => {
  it('guards budgets and ids', () => {
    expect(budgetProblems(50, null)[0]).toMatch(/at least/)
    expect(budgetProblems(6000, 1000)[0]).toMatch(/5x/)
    expect(MadsActionSchema.safeParse({ action: 'status', level: 'campaign', id: '1/../x', status: 'PAUSED' }).success).toBe(false)
  })
  it('flags spend without purchases, low ROAS, rejected ads, CAPI failures, expiry and account problems', () => {
    const s: MadsSnapshot = {
      campaigns: [{ id: '1', name: 'A', spend: 2000, purchases: 0, value: 0 }, { id: '2', name: 'B', spend: 2000, purchases: 2, value: 1000 }],
      disapproved: [{ id: '9', name: 'Ad' }],
      capiFailed: 3,
      tokenExpiresAt: '2026-10-20T00:00:00Z',
      accountStatus: 3,
    }
    const cfg = { ...MADS_DEFAULTS, roas_target: { enabled: true, minRoas: 2, minSpend: 1000, days: 7 } }
    expect(evaluateMads(s, cfg, new Date('2026-10-16T00:00:00Z')).map(f => f.key)).toEqual([
      'spend_no_purchases:1',
      'roas_target:2',
      'disapproved_ads:1',
      'capi_failing',
      'token_expiry',
      'account_problem:3',
    ])
  })
})

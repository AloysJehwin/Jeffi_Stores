import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/crm-insights-attention', () => ({
  getCrmAttention: vi.fn(),
}))

import { getCrmInsights, CRM_SEGMENT_KEYS } from '@/lib/crm-insights'
import { queryOne, queryMany } from '@/lib/db'
import { getCrmAttention } from '@/lib/crm-insights-attention'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockAttention = vi.mocked(getCrmAttention)

const has = (sql: string, ...needles: string[]) => needles.every(n => sql.includes(n))

function setup() {
  mockAttention.mockResolvedValue([
    { kind: 'vip_churn', label: 'A', sub: 'b', href: '/admin/customers/1', severity: 'high' },
  ])

  mockQueryOne.mockImplementation(async (sql: string) => {
    if (has(sql, 'new_customers', 'returning_customers')) {
      return { new_customers: '10', returning_customers: '4', buyers: '8', repeat_buyers: '3', median_days_to_second: '12.5', churned: '2' } as any
    }
    if (has(sql, 'b_lt_1k')) {
      return {
        b_lt_1k: '5', b_1k_5k: '3', b_5k_25k: '2', b_25k_1l: '1', b_gte_1l: '0',
        top_decile_value: '5000', total_value: '20000', aov: '1250.5', paid_orders: '16',
        new_revenue: '8000', returning_revenue: '12000', avg_days_between: '30.2',
      } as any
    }
    if (has(sql, 'vip_aov')) {
      return { vip_aov: '3000', vip_orders: '4', loyal_aov: '2000', loyal_orders: '2' } as any
    }
    if (has(sql, 'vip_returns')) {
      return { vip_orders: '4', vip_returns: '1', loyal_orders: '10', loyal_returns: '0' } as any
    }
    if (has(sql, 'recency', 'satisfaction')) {
      return { scored: '20', recency: '3.1', frequency: '2.9', monetary: '4.0', engagement: '2.2', satisfaction: '3.8' } as any
    }
    if (has(sql, 'healthy_to_rising')) {
      return { compared: '15', healthy_to_rising: '2', healthy_to_high: '1', rising_to_high: '3', recovered: '4' } as any
    }
    if (has(sql, 'unanswered_chats')) {
      return { opened: '30', closed: '25', median_first_response_min: '90', median_resolution_min: '600', unanswered_chats: '2', unanswered_inbound: '1', paid_orders: '16', reviews: '5', avg_rating: '4.2' } as any
    }
    if (has(sql, 'email_sent')) {
      return { email_sent: '100', email_failed: '5', whatsapp_sent: '50', whatsapp_failed: '2', sms_sent: '10', sms_failed: '0', customers: '200', has_email: '180', has_phone: '150', marketing_opt_in: '120', campaign_sent: '80', campaign_failed: '1' } as any
    }
    if (has(sql, 'saved_for_later', 'wishlist_items')) {
      return { a_1_3: '3', v_1_3: '3000', a_3_7: '2', v_3_7: '2000', a_7p: '5', v_7p: '5000', saved_for_later: '4', wishlist_items: '12', wishlist_in_stock: '9' } as any
    }
    if (has(sql, 'open_auto')) {
      return { open: '10', overdue: '3', open_auto: '4', median_hours: '20.5' } as any
    }
    if (has(sql, 'pending_approvals')) {
      return { pending_approvals: '2', open_rfqs: '5', rfqs_in_range: '8', rfqs_converted: '2', open_quotes: '3', open_quotes_value: '50000', credit_customers: '4', credit_limit_total: '100000', credit_used: '25000' } as any
    }
    return null
  })

  mockQueryMany.mockImplementation(async (sql: string) => {
    if (has(sql, "date_trunc('month'", 'cohort')) {
      return [
        { cohort: '2026-01', size: '10', m: '0', active: '10' },
        { cohort: '2026-01', size: '10', m: '1', active: '5' },
        { cohort: '2026-01', size: '10', m: '3', active: '2' },
        { cohort: '2026-02', size: '4', m: '0', active: '4' },
      ] as any
    }
    if (has(sql, 'trend_delta_30d')) {
      return [{ id: 'u1', first_name: 'Jo', last_name: 'Ng', email: 'j@x.com', score: '80', trend_delta_30d: '12' }] as any
    }
    if (has(sql, 'rating', 'product_name')) {
      return [{ id: 'r1', rating: '1', product_name: 'Widget', user_id: 'u2', first_name: 'Sam', last_name: null, email: 's@x.com', created_at: '2026-09-01T00:00:00Z' }] as any
    }
    if (has(sql, 'user_search_history')) {
      return [{ q: 'shoes', n: '9' }] as any
    }
    if (has(sql, 'assigned_to')) {
      return [{ assigned_to: 'a1', first_name: 'Lee', last_name: 'Ka', open: '6', overdue: '1' }] as any
    }
    if (has(sql, 'generate_series')) {
      return [{ week: '2026-08-01', n: '3' }, { week: '2026-08-08', n: '5' }] as any
    }
    if (has(sql, 'GROUP BY 1', 'state')) {
      return [{ name: 'Kerala', customers: '20', revenue: '90000' }] as any
    }
    if (has(sql, 'GROUP BY 1, 2')) {
      return [{ name: 'Kochi', state: 'Kerala', customers: '8', revenue: '40000' }] as any
    }
    return []
  })
}

describe('getCrmInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setup()
  })

  it('returns every group in the output shape', async () => {
    const r = await getCrmInsights({ range: '30d', segment: 'all' })
    for (const k of [
      'growth', 'cohorts', 'economics', 'aovBySegment', 'returnRateBySegment', 'health',
      'healthTransitions', 'healthGains', 'service', 'lowReviews', 'reach', 'intent',
      'topSearches', 'workload', 'tasksByAssignee', 'notesPerWeek', 'b2b',
      'geographyStates', 'geographyCities', 'attention',
    ]) {
      expect(r).toHaveProperty(k)
    }
    expect(r.range).toBe('30d')
    expect(r.segment).toBe('all')
  })

  it('computes repeat rate safely from buyers and returning', async () => {
    const r = await getCrmInsights({ range: '30d', segment: 'all' })
    expect(r.growth.repeatRate).toBeCloseTo(50, 5)
  })

  it('computes B2B RFQ conversion rate', async () => {
    const r = await getCrmInsights({ range: '30d', segment: 'all' })
    expect(r.b2b.conversionRate).toBeCloseTo(25, 5)
  })

  it('computes return rate per segment', async () => {
    const r = await getCrmInsights({ range: '30d', segment: 'all' })
    const vip = r.returnRateBySegment.find(x => x.key === 'vip')
    expect(vip?.returnRate).toBeCloseTo(25, 5)
    const loyal = r.returnRateBySegment.find(x => x.key === 'loyal')
    expect(loyal?.returnRate).toBeCloseTo(0, 5)
  })

  it('builds a 6-column cohort grid with retention percentages', async () => {
    const r = await getCrmInsights({ range: '30d', segment: 'all' })
    expect(r.cohorts.length).toBe(2)
    const jan = r.cohorts.find(c => c.cohort === '2026-01')!
    expect(jan.retention).toHaveLength(6)
    expect(jan.retention[0]).toBeCloseTo(100, 5)
    expect(jan.retention[1]).toBeCloseTo(50, 5)
    expect(jan.retention[2]).toBeNull()
    expect(jan.retention[3]).toBeCloseTo(20, 5)
  })

  it('coerces an unknown segment to all', async () => {
    const r = await getCrmInsights({ range: '30d', segment: 'bogus' as any })
    expect(r.segment).toBe('all')
  })

  it('coerces an unknown range to a valid 30d window', async () => {
    const r = await getCrmInsights({ range: 'decade' as any, segment: 'all' })
    expect(r.range).toBe('30d')
    expect(r.rangeLabel).toBe('Last 30 days')
  })

  it('exposes the segment keys for the client', () => {
    expect(CRM_SEGMENT_KEYS).toContain('vip')
    expect(CRM_SEGMENT_KEYS).toHaveLength(9)
  })

  it('parses numeric strings and includes attention items', async () => {
    const r = await getCrmInsights({ range: '30d', segment: 'all' })
    expect(r.economics.aov).toBeCloseTo(1250.5, 5)
    expect(r.growth.newCustomers).toBe(10)
    expect(r.attention).toHaveLength(1)
  })
})

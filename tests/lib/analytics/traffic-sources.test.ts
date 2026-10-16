import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { getTrafficSources, GOOGLE_ADS_CHANNEL, UNATTRIBUTED_CHANNEL } from '@/lib/analytics/traffic-sources'
import { queryMany } from '@/lib/shared/db'

const mockQueryMany = vi.mocked(queryMany)

beforeEach(() => mockQueryMany.mockReset())

describe('getTrafficSources', () => {
  it('classifies click ids as Google Ads and counts only real online orders', async () => {
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await getTrafficSources(30)
    const [ordersSql, ordersParams] = mockQueryMany.mock.calls[0]
    expect(ordersParams).toEqual([30])
    expect(ordersSql).toMatch(/COALESCE\(gclid, gbraid, wbraid\) IS NOT NULL THEN 'Google Ads'/)
    expect(ordersSql).toMatch(/LOWER\(utm_source\)/)
    expect(ordersSql).toMatch(/FROM orders/)
    expect(ordersSql).toContain(`source = 'online' AND status <> 'cancelled' AND payment_status <> 'unpaid'`)
    const [sessionsSql] = mockQueryMany.mock.calls[1]
    expect(sessionsSql).toMatch(/COUNT\(DISTINCT session_id\)[\s\S]*FROM page_events/)
  })

  it('shapes rows and summarises Google Ads vs attributed vs total', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        { channel: GOOGLE_ADS_CHANNEL, medium: 'cpc', campaign: 'diwali', orders: '3', revenue: '4500.50' },
        { channel: 'newsletter', medium: 'email', campaign: null, orders: '2', revenue: '1000' },
        { channel: UNATTRIBUTED_CHANNEL, medium: null, campaign: null, orders: '5', revenue: '2500' },
      ] as any)
      .mockResolvedValueOnce([
        { channel: UNATTRIBUTED_CHANNEL, medium: null, campaign: null, sessions: '400' },
        { channel: GOOGLE_ADS_CHANNEL, medium: 'cpc', campaign: 'diwali', sessions: '120' },
        { channel: GOOGLE_ADS_CHANNEL, medium: 'cpc', campaign: 'brand', sessions: '30' },
      ] as any)
    const r = await getTrafficSources(7)
    expect(r.orders[0]).toEqual({
      channel: GOOGLE_ADS_CHANNEL,
      medium: 'cpc',
      campaign: 'diwali',
      orders: 3,
      revenue: 4500.5,
    })
    expect(r.sessions[1].sessions).toBe(120)
    expect(r.summary).toEqual({
      totalOrders: 10,
      totalRevenue: 8000.5,
      attributedOrders: 5,
      googleAdsOrders: 3,
      googleAdsRevenue: 4500.5,
      googleAdsSessions: 150,
    })
  })

  it('reports empty instead of failing when a store lacks the columns', async () => {
    mockQueryMany
      .mockRejectedValueOnce(new Error('column "gclid" does not exist'))
      .mockResolvedValueOnce(undefined as any)
    const r = await getTrafficSources(7)
    expect(r.orders).toEqual([])
    expect(r.sessions).toEqual([])
    expect(r.summary.totalOrders).toBe(0)
  })
})

import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/ai-client', () => ({
  aiChat: vi.fn(),
  AiClientError: class AiClientError extends Error {
    constructor(msg: string, public provider: string) { super(msg); this.name = 'AiClientError' }
  },
}))

import { collectBriefingData, narrate, renderBriefingEmail, type BriefingData } from '@/lib/daily-briefing'
import * as db from '@/lib/db'
import * as aiClient from '@/lib/ai-client'

const mockQueryOne = db.queryOne as ReturnType<typeof vi.fn>
const mockQueryMany = db.queryMany as ReturnType<typeof vi.fn>
const mockAiChat = aiClient.aiChat as ReturnType<typeof vi.fn>

function makeYesterday(overrides = {}) {
  return {
    count: '5',
    paid_count: '4',
    cancelled_count: '1',
    pending_count: '0',
    revenue: '8000',
    avg_order_value: '2000',
    ...overrides,
  }
}

function makeSevenDayAvg(overrides = {}) {
  return { avg_revenue: '6000', avg_orders: '4', ...overrides }
}

describe('collectBriefingData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed OrderSummary for yesterday', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeYesterday())
      .mockResolvedValueOnce(makeSevenDayAvg())
      .mockResolvedValueOnce({ count: '2' }) // abandoned checkouts

    mockQueryMany.mockResolvedValue([])

    const data = await collectBriefingData()

    expect(data.yesterday.count).toBe(5)
    expect(data.yesterday.paid_count).toBe(4)
    expect(data.yesterday.cancelled_count).toBe(1)
    expect(data.yesterday.revenue).toBe(8000)
    expect(data.yesterday.avg_order_value).toBe(2000)
  })

  it('computes positive revenue delta vs 7-day avg', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeYesterday({ revenue: '9000' }))
      .mockResolvedValueOnce(makeSevenDayAvg({ avg_revenue: '6000' }))
      .mockResolvedValueOnce({ count: '0' })

    mockQueryMany.mockResolvedValue([])

    const data = await collectBriefingData()
    // (9000 - 6000) / 6000 * 100 = 50
    expect(data.delta_vs_avg.revenue_pct).toBe(50)
  })

  it('computes negative orders delta vs 7-day avg', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeYesterday({ count: '2' }))
      .mockResolvedValueOnce(makeSevenDayAvg({ avg_orders: '5' }))
      .mockResolvedValueOnce({ count: '0' })

    mockQueryMany.mockResolvedValue([])

    const data = await collectBriefingData()
    // (2 - 5) / 5 * 100 = -60
    expect(data.delta_vs_avg.orders_pct).toBe(-60)
  })

  it('handles null yesterday and sevenDayAvg gracefully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    mockQueryMany.mockResolvedValue([])

    const data = await collectBriefingData()
    expect(data.yesterday.count).toBe(0)
    expect(data.yesterday.revenue).toBe(0)
    expect(data.delta_vs_avg.revenue_pct).toBe(0)
    expect(data.delta_vs_avg.orders_pct).toBe(0)
  })

  it('maps top_products from queryMany', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeYesterday())
      .mockResolvedValueOnce(makeSevenDayAvg())
      .mockResolvedValueOnce({ count: '0' })

    mockQueryMany
      .mockResolvedValueOnce([{ product_id: 'p1', product_name: 'Bolt M6', qty: '10', revenue: '1500' }]) // top products
      .mockResolvedValue([])

    const data = await collectBriefingData()
    expect(data.top_products).toHaveLength(1)
    expect(data.top_products[0].product_name).toBe('Bolt M6')
    expect(data.top_products[0].qty).toBe(10)
    expect(data.top_products[0].revenue).toBe(1500)
  })

  it('maps stuck_shipments with parsed numbers', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeYesterday())
      .mockResolvedValueOnce(makeSevenDayAvg())
      .mockResolvedValueOnce({ count: '0' })

    const shipment = {
      order_number: 'ORD-100',
      awb_number: 'AWB-999',
      shipped_at: '2024-01-01T00:00:00Z',
      customer_name: 'Bob',
      total_amount: '3500',
      days_since_shipped: '5',
    }

    mockQueryMany
      .mockResolvedValueOnce([]) // top products
      .mockResolvedValueOnce([]) // low stock
      .mockResolvedValueOnce([shipment]) // stuck shipments
      .mockResolvedValue([])

    const data = await collectBriefingData()
    expect(data.stuck_shipments).toHaveLength(1)
    expect(data.stuck_shipments[0].order_number).toBe('ORD-100')
    expect(data.stuck_shipments[0].total_amount).toBe(3500)
    expect(data.stuck_shipments[0].days_since_shipped).toBe(5)
  })

  it('maps campaign_perf_24h with parsed integers', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeYesterday())
      .mockResolvedValueOnce(makeSevenDayAvg())
      .mockResolvedValueOnce({ count: '3' })

    mockQueryMany
      .mockResolvedValueOnce([]) // top products
      .mockResolvedValueOnce([]) // low stock
      .mockResolvedValueOnce([]) // stuck shipments
      .mockResolvedValueOnce([{ campaign_kind: 'winback_90', sent: '50', opened: '20', clicked: '10', converted: '3' }])

    const data = await collectBriefingData()
    expect(data.campaign_perf_24h).toHaveLength(1)
    expect(data.campaign_perf_24h[0].sent).toBe(50)
    expect(data.campaign_perf_24h[0].opened).toBe(20)
    expect(data.campaign_perf_24h[0].converted).toBe(3)
    expect(data.abandoned_checkouts_24h).toBe(3)
  })

  it('sets briefing_date to yesterday ISO date string', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeYesterday())
      .mockResolvedValueOnce(makeSevenDayAvg())
      .mockResolvedValueOnce(null)
    mockQueryMany.mockResolvedValue([])

    const data = await collectBriefingData()
    expect(data.briefing_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('narrate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sampleData: BriefingData = {
    briefing_date: '2024-01-01',
    yesterday: { count: 5, paid_count: 4, cancelled_count: 1, pending_count: 0, revenue: 8000, avg_order_value: 2000 },
    delta_vs_avg: { revenue_pct: 10, orders_pct: 5 },
    top_products: [{ product_id: 'p1', product_name: 'Bolt M6', qty: 10, revenue: 1500 }],
    low_stock: [],
    stuck_shipments: [],
    abandoned_checkouts_24h: 2,
    campaign_perf_24h: [],
  }

  it('returns trimmed content from aiChat', async () => {
    mockAiChat.mockResolvedValueOnce({ content: '  Revenue was up 10%.  ', provider: 'openai', model: 'gpt-4o-mini', latencyMs: 100, fallbackUsed: false })
    const result = await narrate(sampleData)
    expect(result).toBe('Revenue was up 10%.')
  })

  it('truncates content to 600 chars', async () => {
    const longText = 'x'.repeat(700)
    mockAiChat.mockResolvedValueOnce({ content: longText, provider: 'openai', model: 'gpt-4o-mini', latencyMs: 100, fallbackUsed: false })
    const result = await narrate(sampleData)
    expect(result).toHaveLength(600)
  })

  it('returns empty string when AiClientError is thrown', async () => {
    const { AiClientError } = await import('@/lib/ai-client')
    mockAiChat.mockRejectedValueOnce(new AiClientError('AI unavailable', 'openai'))
    const result = await narrate(sampleData)
    expect(result).toBe('')
  })

  it('returns empty string for any other error', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('network error'))
    const result = await narrate(sampleData)
    expect(result).toBe('')
  })
})

describe('renderBriefingEmail', () => {
  const sampleData: BriefingData = {
    briefing_date: '2024-06-17',
    yesterday: { count: 10, paid_count: 8, cancelled_count: 1, pending_count: 1, revenue: 15000, avg_order_value: 1875 },
    delta_vs_avg: { revenue_pct: 20, orders_pct: -10 },
    top_products: [
      { product_id: 'p1', product_name: 'Bolt M8', qty: 20, revenue: 5000 },
    ],
    low_stock: [
      { id: 'p2', name: 'Nut M6', sku: 'NUT-M6', inventory_quantity: 3 },
    ],
    stuck_shipments: [
      { order_number: 'ORD-001', awb_number: 'AWB-123', shipped_at: '2024-06-10T00:00:00Z', customer_name: 'Alice', total_amount: 2000, days_since_shipped: 7 },
    ],
    abandoned_checkouts_24h: 5,
    campaign_perf_24h: [
      { campaign_kind: 'winback_90', sent: 100, opened: 30, clicked: 10, converted: 2 },
    ],
  }

  it('returns object with subject and html', () => {
    const { subject, html } = renderBriefingEmail(sampleData, 'Revenue was up.')
    expect(subject).toContain('2024-06-17')
    expect(subject).toContain('10 orders')
    expect(typeof html).toBe('string')
  })

  it('includes narration in html when provided', () => {
    const { html } = renderBriefingEmail(sampleData, 'Revenue was up.')
    expect(html).toContain('Revenue was up.')
  })

  it('skips narration block when narration is empty', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).not.toContain('ops@jeffistores.in')
    // The narration block uses 'fff7ed' background
    expect(html).not.toContain('fff7ed')
  })

  it('includes stuck shipment table when shipments exist', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).toContain('ORD-001')
    expect(html).toContain('7d')
  })

  it('includes top products table', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).toContain('Bolt M8')
  })

  it('includes low stock table', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).toContain('Nut M6')
    expect(html).toContain('NUT-M6')
  })

  it('includes campaign performance table', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).toContain('winback_90')
    expect(html).toContain('30%') // open rate
  })

  it('includes abandoned checkout count', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).toContain('5')
  })

  it('formats INR with rupee symbol', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).toContain('₹')
  })

  it('shows positive delta badge with green arrow', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).toContain('#16a34a')
    expect(html).toContain('▲')
    expect(html).toContain('20%')
  })

  it('shows negative delta badge with red arrow', () => {
    const { html } = renderBriefingEmail(sampleData, '')
    expect(html).toContain('#dc2626')
    expect(html).toContain('▼')
    expect(html).toContain('10%')
  })

  it('subject includes revenue formatted with fmtINR', () => {
    const { subject } = renderBriefingEmail(sampleData, '')
    expect(subject).toContain('₹')
    expect(subject).toContain('15,000')
  })

  it('skips stuck shipments section when list is empty', () => {
    const data = { ...sampleData, stuck_shipments: [] }
    const { html } = renderBriefingEmail(data, '')
    expect(html).not.toContain('Stuck shipments')
  })
})

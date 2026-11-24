import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@admin/app/(admin)/admin/dashboard/_components/OpsInsights', () => ({ default: () => <div>ops-insights</div> }))
vi.mock('@admin/app/(admin)/admin/dashboard/_components/ProductInsights', () => ({ default: () => <div>product-insights</div> }))
vi.mock('@admin/app/(admin)/admin/dashboard/_components/GrowthInsights', () => ({ default: () => <div>growth-insights</div> }))

import AnalyticsDashboardClient from '@admin/app/(admin)/admin/dashboard/_components/AnalyticsDashboardClient'

const analytics = (over: Record<string, unknown> = {}): any => ({
  range: '30d',
  rangeLabel: 'Last 30 days',
  trendBucket: 'day',
  trend: [{ label: '1', revenue: 100, orders: 1 }],
  kpis: { revenue: 125000, revenuePrev: 100000, revenuePct: 25, orders: 40, ordersPrev: 50, ordersPct: -20, aov: 3125, aovPrev: 2000, aovPct: 56, customers: 30, customersPrev: 20, customersPct: 50 },
  insights: {
    money: { gross: 45000, marginPct: 36, marginPctPrev: 30, grossPct: 10, units: 80, unitsPrev: 60, unitsPct: 33 },
    conversion: { rate: 2.5, ratePct: 5, sessions: 1600, paidOrders: 40, paidOrdersPrev: 20 },
  },
  payment: { online: 90000, cod: 30000, other: 5000, codOutstanding: 12000, codOutstandingCount: 3 },
  customerSplit: { newCustomers: 10, returningCustomers: 30 },
  buyerSplit: { business: 5, consumer: 35, businessRevenue: 50000, consumerRevenue: 75000 },
  topCategories: [{ name: 'Power Tools', revenue: 70000 }],
  topBrands: [{ name: 'Bosch', revenue: 60000 }],
  inventory: { inStock: 120, lowStock: 8, outOfStock: 2, stockValue: 500000 },
  returns: { total: 4, rtoInTransit: 1, rtoDelivered: 2 },
  ...over,
})
const metrics: any = {
  funnel: { pending: 3, processing: 2, shipped: 4, outForDelivery: 1, delivered: 20, cancelled: 1 },
  topProducts: [{ id: 'p1', name: 'Cordless Drill', qty: 12, revenue: 24000 }],
  recentOrders: [
    { id: 'abcdef123456', order_number: 'ORD-9', status: 'pending', total_amount: '1500', users: { first_name: 'Asha', last_name: 'Rao' } },
    { id: 'zzzzzzzz1111', status: 'delivered', total_amount: '300', customer_name: null },
  ],
}
const fetchMock = vi.fn()
const renderIt = (scopes: string[], over?: any) =>
  render(asMember(<AnalyticsDashboardClient initial={analytics(over)} metrics={metrics} host="store.test" username="Aloys" ops={<div>ops-slot</div>} footer={<div>footer-slot</div>} />, scopes))

describe('AnalyticsDashboardClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders the greeting, slots, lists and child sections', () => {
    renderIt(['financial:read', 'inventory:read', 'returns:read', 'traffic:read'])
    expect(screen.getByText('Welcome back, Aloys')).toBeInTheDocument()
    expect(screen.getByText(/Store at a glance, last 30 days/)).toBeInTheDocument()
    for (const t of ['ops-slot', 'footer-slot', 'ops-insights', 'product-insights', 'growth-insights']) expect(screen.getByText(t)).toBeInTheDocument()
    expect(screen.getByText('Gross Margin')).toBeInTheDocument()
    expect(screen.getByText('1. Cordless Drill')).toBeInTheDocument()
    expect(screen.getByText('#ORD-9')).toBeInTheDocument()
    expect(screen.getByText('#zzzzzzzz')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Guest')).toBeInTheDocument()
    expect(screen.getByText('Stock Status')).toBeInTheDocument()
    expect(screen.getByText('Returns & RTO')).toBeInTheDocument()
    expect(screen.getByText(/COD outstanding \(3\)/)).toBeInTheDocument()
    expect(screen.getByText('Power Tools')).toBeInTheDocument()
    expect(screen.getByText('Bosch')).toBeInTheDocument()
  })

  it('computes the repeat rate from new vs returning buyers', () => {
    renderIt([])
    expect(screen.getByText(/30 returning of 40 buyers/)).toBeInTheDocument()
  })

  it('hides finance, stock and returns blocks without scopes and shows Paid Orders', () => {
    renderIt([], { payment: { online: 1, cod: 1, other: 0, codOutstanding: 0, codOutstandingCount: 0 } })
    expect(screen.getAllByText('Prev: 20').length).toBeGreaterThan(0)
    expect(screen.queryByText('Gross Margin')).not.toBeInTheDocument()
    expect(screen.queryByText('Stock Status')).not.toBeInTheDocument()
    expect(screen.queryByText('Returns & RTO')).not.toBeInTheDocument()
    expect(screen.queryByText(/COD outstanding/)).not.toBeInTheDocument()
  })

  it('refetches analytics when the range changes and swaps the data', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ analytics: analytics({ range: '7d', rangeLabel: 'Last 7 days' }) }) })
    renderIt(['financial:read'])
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    await waitFor(() => expect(screen.getByText(/Store at a glance, last 7 days/)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/dashboard/analytics?range=7d', { credentials: 'include' })
  })

  it('keeps the previous data when the refetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    renderIt([])
    fireEvent.click(screen.getByRole('button', { name: 'Year' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '7d' })).not.toBeDisabled())
    expect(screen.getByText(/Store at a glance, last 30 days/)).toBeInTheDocument()
  })

  it('does not refetch for the already-selected range', () => {
    renderIt([])
    fireEvent.click(screen.getByRole('button', { name: '30d' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

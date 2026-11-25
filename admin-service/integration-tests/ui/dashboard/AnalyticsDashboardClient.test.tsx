import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  trend: [{ label: '1', revenue: 100, orders: 1 }, { label: '2', revenue: 200, orders: 2 }],
  trendPrev: [{ label: '1', revenue: 80, orders: 1 }, { label: '2', revenue: 90, orders: 1 }],
  spark: { orders: [1, 2], aov: [100, 120], customers: [1, 2], conversion: [1, 2] },
  flow: { placed: 40, paid: 35, shipped: 30, delivered: 25, cancelled: 2, returned: 1 },
  kpis: { revenue: 125000, revenuePrev: 100000, revenuePct: 25, orders: 40, ordersPrev: 50, ordersPct: -20, aov: 3125, aovPrev: 2000, aovPct: 56, customers: 30, customersPrev: 20, customersPct: 50 },
  insights: {
    money: { gross: 45000, marginPct: 36, marginPctPrev: 30, grossPct: 10, units: 80, unitsPrev: 60, unitsPct: 33 },
    fulfilment: { avgHoursToShip: 20, avgHoursToShipPrev: 30, onTimePct: 90, returnRate: 2 },
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
const activity = (over: Record<string, unknown> = {}): any => {
  const days = Array.from({ length: 26 * 7 }, (_, i) => ({ date: new Date(Date.UTC(2026, 4, 25 + i)).toISOString().slice(0, 10), shipped: i % 5, placed: i % 4, customers: 1, top: [] }))
  return {
    weeks: 26,
    channel: 'all',
    from: days[0].date,
    to: days[days.length - 1].date,
    days,
    totals: { shipped: 260, busiestDay: { date: days[4].date, count: 4 }, longestStreak: 3, currentStreak: 2 },
    weekday: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, avg: 2 })),
    thisWeek: days.slice(0, 7).map(d => ({ date: d.date, placed: d.placed })),
    placedAvg8w: 1.5,
    timeToShip: [{ bucket: '<1d', count: 3 }, { bucket: '1-2d', count: 2 }, { bucket: '2-4d', count: 1 }, { bucket: '4-7d', count: 0 }, { bucket: '7d+', count: 0 }],
    medianDaysToShip: 1,
    shippedWithin2dPct: 80,
    throughput: [{ weekStart: days[0].date, placed: 5, shipped: 4 }],
    backlog: 3,
    topProducts: [],
    ...over,
  }
}
const fetchMock = vi.fn()
const renderIt = (scopes: string[], over?: any, act: any = activity()) =>
  render(asMember(<AnalyticsDashboardClient initial={analytics(over)} activity={act} metrics={metrics} host="store.test" username="Aloys" ops={<div>ops-slot</div>} footer={<div>footer-slot</div>} />, scopes))

describe('AnalyticsDashboardClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders the greeting, slots, lists and child sections', () => {
    renderIt(['financial:read', 'inventory:read', 'returns:read', 'traffic:read'])
    expect(screen.getByText('Welcome back, Aloys')).toBeInTheDocument()
    expect(screen.getByText(/Revenue, orders and fulfilment · last 30 days/)).toBeInTheDocument()
    expect(screen.getByText('Store analytics')).toBeInTheDocument()
    for (const t of ['ops-slot', 'footer-slot', 'ops-insights', 'product-insights', 'growth-insights']) expect(screen.getByText(t)).toBeInTheDocument()
    expect(screen.getByText('Gross margin')).toBeInTheDocument()
    expect(screen.getByText('1. Cordless Drill')).toBeInTheDocument()
    expect(screen.getByText('#ORD-9')).toBeInTheDocument()
    expect(screen.getByText('#zzzzzzzz')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Guest')).toBeInTheDocument()
    expect(screen.getByText('Stock status')).toBeInTheDocument()
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
    expect(screen.getByText('Paid orders')).toBeInTheDocument()
    expect(screen.queryByText('Gross margin')).not.toBeInTheDocument()
    expect(screen.queryByText('Stock status')).not.toBeInTheDocument()
    expect(screen.queryByText('Returns & RTO')).not.toBeInTheDocument()
    expect(screen.queryByText(/COD outstanding/)).not.toBeInTheDocument()
  })

  it('refetches analytics when the range changes and swaps the data', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ analytics: analytics({ range: '7d', rangeLabel: 'Last 7 days' }) }) })
    renderIt(['financial:read'])
    fireEvent.click(screen.getByRole('radio', { name: '7d' }))
    await waitFor(() => expect(screen.getByText(/Revenue, orders and fulfilment · last 7 days/)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/dashboard/analytics?range=7d', { credentials: 'include' })
  })

  it('keeps the previous data when the refetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    renderIt([])
    fireEvent.click(screen.getByRole('radio', { name: 'Year' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: '7d' })).not.toBeDisabled())
    expect(screen.getByText(/Revenue, orders and fulfilment · last 30 days/)).toBeInTheDocument()
  })

  it('hides the financial links without the scope', () => {
    renderIt([])
    expect(screen.queryByRole('link', { name: 'Avg order value' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', expect.stringContaining('/admin/orders'))
  })

  it('opens the shipped-orders drawer from the card and returns focus on close', async () => {
    renderIt([])
    const card = screen.getByRole('button', { name: /Orders shipped, open details/ })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(card)
    const dialog = await screen.findByRole('dialog', { name: 'Orders shipped' })
    expect(within(dialog).getByText('26-week total')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(card).toHaveFocus())
  })

  it('refetches the activity route when the drawer period or channel changes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ activity: activity({ weeks: 13 }) }) })
    renderIt([])
    fireEvent.click(screen.getByRole('button', { name: /Orders shipped, open details/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Period' }))
    fireEvent.click(screen.getByRole('option', { name: 'Last 13 weeks' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/dashboard/activity?weeks=13&channel=all', { credentials: 'include' }))
    await waitFor(() => expect(within(dialog).getByText('13-week total')).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Channel' }))
    fireEvent.click(screen.getByRole('option', { name: 'COD' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/dashboard/activity?weeks=13&channel=cod', { credentials: 'include' }))
  })

  it('filters this week by channel through the activity route', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ activity: activity({ channel: 'online' }) }) })
    renderIt([])
    fireEvent.click(screen.getByRole('radio', { name: 'COD' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/dashboard/activity?weeks=26&channel=cod', { credentials: 'include' }))
  })

  it('shows an empty state and no drawer when activity is missing', () => {
    renderIt([], undefined, null)
    expect(screen.getByText('Shipped orders are unavailable right now.')).toBeInTheDocument()
    expect(screen.getByText('Weekly activity is unavailable right now.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Orders shipped, open details/ })).not.toBeInTheDocument()
  })

  it('does not refetch for the already-selected range', () => {
    renderIt([])
    fireEvent.click(screen.getByRole('radio', { name: '30d' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

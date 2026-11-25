import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@admin/app/(admin)/admin/products/[id]/analytics/_components/TrafficCard', () => ({
  TrafficCard: ({ series }: any) => <div>traffic-card:{series.length}</div>,
}))
vi.mock('@/components/ui/CopySku', () => ({ default: () => <span>copy</span> }))

import ProductAnalyticsClient from '@admin/app/(admin)/admin/products/[id]/analytics/ProductAnalyticsClient'

const buyers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ orderNumber: `ORD${i}`, createdAt: '2026-03-01T10:00:00Z', quantity: 2, total: 1500 + i, customerName: `Buyer ${i}` }))

const base: any = {
  product: { id: 'p1', name: 'Widget', sku: 'W-1', slug: 'widget', brandName: 'Acme', stock: 4, basePrice: 100 },
  days: 30,
  totals: { views: 1200, uniqueViewers: 800, cartAdds: 90, orders: 12, revenue: 18000, quantitySold: 20, conversionRate: 1, cartConversionRate: 13, revenuePerView: 15, activeCarts: 3 },
  timeSeries: [{ date: '2026-03-01', views: 5, carts: 1, orders: 0 }],
  referrers: [{ referrer: 'google.com', sessions: 400 }],
  recentBuyers: buyers(7),
  variantBreakdown: [
    { variantName: 'Red', orders: 5, quantity: 8, revenue: 8000 },
    { variantName: null, orders: 7, quantity: 12, revenue: 10000 },
  ],
}

const fetchMock = vi.fn()

describe('ProductAnalyticsClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders toolbar, KPIs and the preview cards from the initial data', () => {
    render(<ProductAnalyticsClient productId="p1" initial={base} />)
    expect(screen.getByText(/SKU: W-1/)).toBeInTheDocument()
    expect(screen.getByText('Brand: Acme')).toBeInTheDocument()
    expect(screen.getByText('Views')).toBeInTheDocument()
    expect(screen.getByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('3 active now')).toBeInTheDocument()
    expect(screen.getByText('₹18,000')).toBeInTheDocument()
    expect(screen.getByText('traffic-card:1')).toBeInTheDocument()
    expect(screen.getByText('google.com')).toBeInTheDocument()
    expect(screen.getByText('No variant')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('previews five buyers, with a link to the full list in a dialog', () => {
    render(<ProductAnalyticsClient productId="p1" initial={base} />)
    expect(screen.getAllByRole('link', { name: /Buyer \d/ })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'View all (7) →' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('link', { name: /Buyer \d/ })).toHaveLength(7)
    expect(within(dialog).getByText('7 orders · last 30 days')).toBeInTheDocument()
  })

  it('shows empty-state copy when a card has no rows', () => {
    render(<ProductAnalyticsClient productId="p1" initial={{ ...base, referrers: [], recentBuyers: [], variantBreakdown: [] }} />)
    expect(screen.getByText('No referrer data yet.')).toBeInTheDocument()
    expect(screen.getByText('No paid orders in this range.')).toBeInTheDocument()
    expect(screen.getByText('No buyers yet.')).toBeInTheDocument()
  })

  it('changing the range refetches and renders the new data', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...base, days: 7, referrers: [{ referrer: 'bing.com', sessions: 9 }] }) })
    render(<ProductAnalyticsClient productId="p1" initial={base} />)
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(screen.getByRole('button', { name: '7d' })).toBeDisabled()
    await waitFor(() => expect(screen.getByText('bing.com')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/products/p1/analytics?days=7', { credentials: 'include' })
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the old data when the refetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    render(<ProductAnalyticsClient productId="p1" initial={base} />)
    fireEvent.click(screen.getByRole('button', { name: '90d' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '90d' })).not.toBeDisabled())
    expect(screen.getByText('google.com')).toBeInTheDocument()
  })
})

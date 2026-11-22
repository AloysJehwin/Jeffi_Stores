import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarketplaceOverview from '@/components/admin/marketplace/MarketplaceOverview'
import type { MarketplaceOverview as Overview } from '@/lib/marketplace/console'

// Overview tab: fetches /api/admin/<channel>/console, then shows KPIs, a stock/failed-events
// warning banner and the recent pushes table. Drives the three states (loading, error, loaded)
// by mocking the global fetch the kit `api()` helper calls.

const data: Overview = {
  kpis: {
    ordersToday: 4,
    orders7d: 25,
    sales7d: 125000,
    awaitingAccept: 2,
    breachingSla: 1,
    rtdPending: 3,
    returnsOpen: 0,
    stockIssues: 1,
  },
  counts: {} as Overview['counts'],
  lastPushAt: '2026-01-01T10:00:00.000Z',
  pendingEvents: 0,
  failedEvents: 2,
  recentEvents: [
    {
      id: 'e1',
      received_at: '2026-01-01T09:00:00.000Z',
      event_type: 'order.created',
      external_order_id: 'MYN-123',
      status: 'done',
      source: 'push',
      attempts: 1,
      last_error: null,
    },
  ],
}

function mockFetch(ok: boolean, body: unknown) {
  global.fetch = vi.fn<(...a: any[]) => any>().mockResolvedValue({
    ok,
    json: async () => body,
  }) as unknown as typeof fetch
}

describe('MarketplaceOverview (fetch-driven)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the loading skeleton before data arrives', () => {
    // Never-resolving fetch keeps it in the loading state.
    global.fetch = vi.fn<(...a: any[]) => any>().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch
    render(<MarketplaceOverview channel="myntra" />)
    // The skeleton carries the real KPI labels.
    expect(screen.getByText('Orders today')).toBeInTheDocument()
  })

  it('renders KPIs and the recent-pushes table once data loads', async () => {
    mockFetch(true, data)
    render(<MarketplaceOverview channel="myntra" />)
    // Wait for the loaded value (KPI value, not just the skeleton label).
    expect(await screen.findByText('25')).toBeInTheDocument()
    expect(screen.getByText('order.created')).toBeInTheDocument()
    expect(screen.getByText('MYN-123')).toBeInTheDocument()
  })

  it('warns about stock issues and failed events when present', async () => {
    mockFetch(true, data)
    render(<MarketplaceOverview channel="myntra" />)
    expect(await screen.findByText(/could not move stock/)).toBeInTheDocument()
    expect(screen.getByText(/failed to process/)).toBeInTheDocument()
  })

  it('shows the empty table message when there are no events', async () => {
    mockFetch(true, { ...data, recentEvents: [], failedEvents: 0, kpis: { ...data.kpis, stockIssues: 0 } })
    render(<MarketplaceOverview channel="ajio" />)
    expect(await screen.findByText('No events from AJIO yet.')).toBeInTheDocument()
  })

  it('renders the error state when the fetch fails', async () => {
    mockFetch(false, { error: 'Boom from server' })
    render(<MarketplaceOverview channel="myntra" />)
    expect(await screen.findByText('Boom from server')).toBeInTheDocument()
  })
})

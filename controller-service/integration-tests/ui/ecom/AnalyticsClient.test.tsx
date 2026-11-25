import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const push = vi.fn<(...a: any[]) => any>()
let query = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/dashboard/showcase/s1/analytics',
  useSearchParams: () => new URLSearchParams(query),
}))

const reload = vi.fn<(...a: any[]) => any>()
let overview: { data: any; error: string | null; loading: boolean } = { data: null, error: null, loading: false }
const requested: string[] = []
vi.mock('@/components/admin/overview/kit', () => ({
  PeriodBar: ({ onRefresh }: any) => (
    <button type="button" onClick={onRefresh}>
      Refresh period
    </button>
  ),
  usePeriod: () => [{ from: '2026-11-01', to: '2026-11-30' }, vi.fn<(...a: any[]) => any>()],
  useOverviewData: (url: string) => {
    requested.push(url)
    return { ...overview, reload }
  },
}))
vi.mock('@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/_components/OverviewTab', () => ({ default: (p: any) => <div data-testid="tab-body">OverviewTab:{p.data.tab}:{p.csvHref ?? ''}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/_components/AcquisitionTab', () => ({ default: (p: any) => <div data-testid="tab-body">AcquisitionTab:{p.data.tab}:{p.csvHref ?? ''}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/_components/BehaviourTab', () => ({ default: (p: any) => <div data-testid="tab-body">BehaviourTab:{p.data.tab}:{p.csvHref ?? ''}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/_components/FunnelTab', () => ({ default: (p: any) => <div data-testid="tab-body">FunnelTab:{p.data.tab}:{p.csvHref ?? ''}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/_components/LeadsTab', () => ({ default: (p: any) => <div data-testid="tab-body">LeadsTab:{p.data.tab}:{p.csvHref ?? ''}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/_components/AudienceTab', () => ({ default: (p: any) => <div data-testid="tab-body">AudienceTab:{p.data.tab}:{p.csvHref ?? ''}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/_components/RealtimeTab', () => ({ default: (p: any) => <div data-testid="tab-body">RealtimeTab:{p.data.tab}:{p.csvHref ?? ''}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/_components/AnalyticsLoading', () => ({ default: ({ tab }: any) => <div data-testid="loading">loading {tab}</div> }))

import AnalyticsClient from '@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/analytics/AnalyticsClient'

const view = (status: any = 'live') => render(<AnalyticsClient siteId="s1" name="Acme Studio" host="acme.jeffi.site" status={status} tenantSlug="acme ws" />)

describe('Showcase AnalyticsClient', () => {
  beforeEach(() => {
    query = ''
    requested.length = 0
    overview = { data: null, error: null, loading: false }
  })
  afterEach(() => vi.useRealTimers())

  it('requests the overview tab for the period and shows a loader until data arrives', () => {
    view()
    expect(screen.getByText('Acme Studio')).toBeInTheDocument()
    expect(requested[0]).toBe('/api/ecom/showcase/s1/analytics?tenant=acme%20ws&tab=overview&from=2026-11-01&to=2026-11-30')
    expect(screen.getByTestId('loading')).toHaveTextContent('loading overview')
    expect(screen.getByRole('link', { name: /Enquiries/ })).toHaveAttribute('href', '/dashboard/showcase/s1/leads?tenant=acme%20ws')
  })

  it('renders the tab body once data for that tab is ready', () => {
    overview.data = { tab: 'overview' }
    view()
    expect(screen.getByTestId('tab-body')).toHaveTextContent('OverviewTab:overview')
    expect(screen.queryByTestId('loading')).toBeNull()
  })

  it('ignores data that belongs to another tab', () => {
    query = 'tab=funnel'
    overview.data = { tab: 'overview' }
    view()
    expect(screen.getByTestId('loading')).toHaveTextContent('loading funnel')
  })

  it('switching tabs pushes the tab and the period to the URL', () => {
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Funnel' }))
    expect(push).toHaveBeenCalledWith('/dashboard/showcase/s1/analytics?tab=funnel&from=2026-11-01&to=2026-11-30', { scroll: false })
  })

  it('the leads tab gets a CSV link for the period', () => {
    query = 'tab=leads'
    overview.data = { tab: 'leads' }
    view()
    expect(screen.getByTestId('tab-body')).toHaveTextContent('format=csv&from=2026-11-01&to=2026-11-30')
  })

  it('shows an error with a retry that reloads', () => {
    overview.error = 'Analytics unavailable'
    view()
    expect(screen.getByText('Analytics unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reload).toHaveBeenCalled()
  })

  it('explains that a draft or paused site is not counted', () => {
    const { unmount } = view('draft')
    expect(screen.getByText(/This site isn’t published yet/)).toBeInTheDocument()
    unmount()
    view('paused')
    expect(screen.getByText(/This site is paused/)).toBeInTheDocument()
  })

  it('has no warning for a live site', () => {
    view('live')
    expect(screen.queryByText(/isn’t published yet|is paused/)).toBeNull()
  })

  it('real-time tab skips the period and polls while the page is visible', () => {
    vi.useFakeTimers()
    query = 'tab=realtime'
    overview.data = { tab: 'realtime' }
    view()
    expect(requested[0]).toBe('/api/ecom/showcase/s1/analytics?tenant=acme%20ws&tab=realtime')
    expect(screen.getByText(/visits in the last 30 minutes/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh period' })).toBeNull()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

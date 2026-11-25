import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/traffic',
  useSearchParams: () => sp,
}))

const reload = vi.fn()
let overview: { data: any; error: string | null; loading: boolean }
const urls: string[] = []
vi.mock('@/components/admin/overview/kit', () => ({
  usePeriod: () => [{ from: '2026-01-01', to: '2026-01-31' }, vi.fn()],
  PeriodBar: ({ onRefresh, busy }: any) => (
    <button type="button" onClick={onRefresh} disabled={busy}>
      refresh-period
    </button>
  ),
  useOverviewData: (url: string) => {
    urls.push(url)
    return { ...overview, reload }
  },
}))
vi.mock('@admin/app/(admin)/admin/traffic/_components/OverviewTab', () => ({ default: ({ data }: any) => <div>overview-tab:{data.visitors}</div> }))
vi.mock('@admin/app/(admin)/admin/traffic/_components/AcquisitionTab', () => ({ default: () => <div>acquisition-tab</div> }))
vi.mock('@admin/app/(admin)/admin/traffic/_components/BehaviourTab', () => ({ default: () => <div>behaviour-tab</div> }))
vi.mock('@admin/app/(admin)/admin/traffic/_components/FunnelTab', () => ({ default: () => <div>funnel-tab</div> }))
vi.mock('@admin/app/(admin)/admin/traffic/_components/ProductsTab', () => ({ default: () => <div>products-tab</div> }))
vi.mock('@admin/app/(admin)/admin/traffic/_components/SearchTab', () => ({ default: () => <div>search-tab</div> }))
vi.mock('@admin/app/(admin)/admin/traffic/_components/AudienceTab', () => ({ default: () => <div>audience-tab</div> }))
vi.mock('@admin/app/(admin)/admin/traffic/_components/RealtimeTab', () => ({ default: () => <div>realtime-tab</div> }))
vi.mock('@admin/app/(admin)/admin/traffic/_components/TrafficLoading', () => ({ default: ({ tab }: any) => <div>loading:{tab}</div> }))

import TrafficClient from '@admin/app/(admin)/admin/traffic/TrafficClient'

describe('TrafficClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    overview = { data: null, error: null, loading: true }
    urls.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('shows the heading, all tabs and the loading skeleton while data is pending', () => {
    render(<TrafficClient />)
    expect(screen.getByText('Traffic')).toBeInTheDocument()
    for (const l of ['Overview', 'Acquisition', 'Behaviour', 'Funnel', 'Products', 'Search', 'Audience', 'Real-time']) {
      expect(screen.getByRole('tab', { name: l })).toBeInTheDocument()
    }
    expect(screen.getByText('loading:overview')).toBeInTheDocument()
    expect(urls[0]).toBe('/api/admin/traffic?tab=overview&from=2026-01-01&to=2026-01-31')
  })

  it('renders the tab body once data for that tab arrives', () => {
    overview = { data: { tab: 'overview', visitors: 42 }, error: null, loading: false }
    render(<TrafficClient />)
    expect(screen.getByText('overview-tab:42')).toBeInTheDocument()
  })

  it('does not render another tab’s data', () => {
    sp = new URLSearchParams('tab=funnel')
    overview = { data: { tab: 'overview' }, error: null, loading: false }
    render(<TrafficClient />)
    expect(screen.getByText('loading:funnel')).toBeInTheDocument()
    expect(screen.queryByText('funnel-tab')).not.toBeInTheDocument()
  })

  it('shows an error with a retry that reloads', () => {
    overview = { data: null, error: 'Boom', loading: false }
    render(<TrafficClient />)
    expect(screen.getByText('Boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('switching tab pushes the tab with the period', () => {
    render(<TrafficClient />)
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    const [url, opts] = push.mock.calls[0]
    expect(url).toBe('/admin/traffic?tab=search&from=2026-01-01&to=2026-01-31')
    expect(opts).toEqual({ scroll: false })
  })

  it('the refresh button reloads', () => {
    overview = { data: null, error: null, loading: false }
    render(<TrafficClient />)
    fireEvent.click(screen.getByRole('button', { name: 'refresh-period' }))
    expect(reload).toHaveBeenCalled()
  })

  it('real-time tab fetches without a period, shows the live note and polls every 30s', () => {
    vi.useFakeTimers()
    sp = new URLSearchParams('tab=realtime')
    overview = { data: { tab: 'realtime' }, error: null, loading: false }
    render(<TrafficClient />)
    expect(urls[0]).toBe('/api/admin/traffic?tab=realtime')
    expect(screen.getByText(/Live: the last 30 minutes/)).toBeInTheDocument()
    expect(screen.getByText('realtime-tab')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'refresh-period' })).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

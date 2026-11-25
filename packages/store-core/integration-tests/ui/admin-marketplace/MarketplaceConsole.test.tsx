import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import MarketplaceConsole from '@/components/admin/marketplace/MarketplaceConsole'
import { renderAs, res, routeFetch, callsTo } from './marketplace-kit'

// MarketplaceConsole: the per-marketplace shell. Connection status loads first; until connected only the
// connect panel is offered; once connected the tabs switch the body. Every tab body and the connect panel
// are stubbed so only the shell's own behaviour is under test.
const push = vi.fn()
const showToast = vi.fn<(...a: any[]) => any>()
let params = ''
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/myntra',
  useSearchParams: () => new URLSearchParams(params),
}))
vi.mock('@/components/admin/marketplace/ConnectPanel', () => ({
  default: ({ status, canWrite, onChanged, token, onToken }: any) => (
    <div data-testid="panel" data-can-write={String(canWrite)}>
      {status.fields.length} fields {token ? `token:${token}` : ''}
      <button type="button" onClick={() => onChanged('Saved!')}>
        panel changed
      </button>
      <button type="button" onClick={() => onToken('tok_1')}>
        panel token
      </button>
    </div>
  ),
  modeBadge: (m: string | null) => (m ? <span data-testid="mode">{m}</span> : null),
}))
vi.mock('@/components/admin/marketplace/InventoryPanel', () => ({ default: () => <div>inventory panel</div> }))
vi.mock('@/components/admin/marketplace/ListingsMapper', () => ({ default: () => <div>listings panel</div> }))
vi.mock('@/components/admin/marketplace/MarketplaceOverview', () => ({ default: ({ channel }: any) => <div>overview:{channel}</div> }))
vi.mock('@/components/admin/marketplace/MarketplaceReturns', () => ({ default: () => <div>returns panel</div> }))
vi.mock('@/components/admin/marketplace/OrdersQueue', () => ({ default: () => <div>orders panel</div> }))
vi.mock('@/components/admin/marketplace/SettlementsPanel', () => ({ default: () => <div>settlements panel</div> }))
vi.mock('@/components/admin/marketplace/skeletons', () => ({ MarketplaceBodyLoading: ({ tab }: any) => <div data-testid="body-loading">{tab}</div> }))

const status = (over: Record<string, unknown> = {}) => ({
  channel: 'myntra',
  connected: true,
  mode: 'live',
  fields: [{ key: 'a' }, { key: 'b' }],
  pushUrl: 'https://shop.test/api/webhooks/myntra',
  hasPushToken: true,
  pushTokenRotatedAt: null,
  previousTokenValidUntil: null,
  ipAllowlist: [],
  lastEventAt: null,
  ...over,
})

const CONN = /\/api\/admin\/[a-z]+\/connection/

describe('MarketplaceConsole', () => {
  beforeEach(() => {
    push.mockClear()
    showToast.mockClear()
    params = ''
  })

  it('shows the body skeleton, then the overview for a connected store', async () => {
    routeFetch([[CONN, res(status())]])
    renderAs(<MarketplaceConsole channel="myntra" />)
    expect(screen.getByTestId('body-loading')).toHaveTextContent('overview')
    expect(await screen.findByText('overview:myntra')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Myntra' })).toBeInTheDocument()
    expect(screen.getAllByTestId('mode')[0]).toHaveTextContent('live')
    expect(screen.getByRole('button', { name: 'Myntra connection (Connected)' })).toBeInTheDocument()
    expect(screen.getByText('https://shop.test/api/webhooks/myntra')).toBeInTheDocument()
    expect(screen.getByText('None yet')).toBeInTheDocument()
    expect(screen.getByText(/No orders have arrived yet/)).toBeInTheDocument()
  })

  it('shows the last event time when one exists', async () => {
    routeFetch([[CONN, res(status({ lastEventAt: '2026-01-02T10:00:00.000Z' }))]])
    renderAs(<MarketplaceConsole channel="myntra" />)
    await screen.findByText('overview:myntra')
    expect(screen.queryByText('None yet')).toBeNull()
    expect(screen.queryByText(/No orders have arrived yet/)).toBeNull()
  })

  it('shows the load error in the body and the gear', async () => {
    routeFetch([[CONN, res({ error: 'Cannot reach Myntra' }, false)]])
    renderAs(<MarketplaceConsole channel="myntra" />)
    expect(await screen.findByText('Cannot reach Myntra')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /connection \(/ }))
    expect(screen.getAllByText('Cannot reach Myntra')).toHaveLength(2)
  })

  it('offers only the connect panel on the overview of an unconnected store', async () => {
    routeFetch([[CONN, res(status({ connected: false, mode: null }))]])
    renderAs(<MarketplaceConsole channel="ajio" />)
    expect(await screen.findByText('Connect AJIO')).toBeInTheDocument()
    expect(screen.getByTestId('panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AJIO connection (Not connected)' })).toBeInTheDocument()
    expect(screen.queryByTestId('mode')).toBeNull()
  })

  it('tells an unconnected store to connect first on other tabs, and the button opens the gear', async () => {
    params = 'tab=orders'
    routeFetch([[CONN, res(status({ connected: false, mode: null }))]])
    renderAs(<MarketplaceConsole channel="flipkart" />)
    expect(await screen.findByText('Connect Flipkart first')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('opens the gear straight away for ?connect=1', async () => {
    params = 'connect=1'
    routeFetch([[CONN, res(status({ connected: false, mode: null }))]])
    renderAs(<MarketplaceConsole channel="myntra" />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it.each([
    ['orders', 'orders panel'],
    ['returns', 'returns panel'],
    ['listings', 'listings panel'],
    ['inventory', 'inventory panel'],
    ['settlements', 'settlements panel'],
  ])('opens the %s tab from the URL', async (tab, text) => {
    params = `tab=${tab}`
    routeFetch([[CONN, res(status())]])
    renderAs(<MarketplaceConsole channel="myntra" />)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('falls back to the overview for an unknown tab', async () => {
    params = 'tab=bogus'
    routeFetch([[CONN, res(status())]])
    renderAs(<MarketplaceConsole channel="myntra" />)
    expect(await screen.findByText('overview:myntra')).toBeInTheDocument()
  })

  it('switches tab through the router, keeping other params', async () => {
    params = 'foo=1'
    routeFetch([[CONN, res(status())]])
    renderAs(<MarketplaceConsole channel="myntra" />)
    await screen.findByText('overview:myntra')
    fireEvent.click(screen.getByRole('tab', { name: 'Orders' }))
    expect(push).toHaveBeenCalledWith('/admin/myntra?foo=1&tab=orders', { scroll: false })
    expect(await screen.findByText('orders panel')).toBeInTheDocument()
  })

  it('passes write access to the connect panel, toasts a change and reloads the status', async () => {
    const f = routeFetch([[CONN, res(status())]])
    renderAs(<MarketplaceConsole channel="myntra" />, 'reader')
    await screen.findByText('overview:myntra')
    fireEvent.click(screen.getByRole('button', { name: /connection \(/ }))
    expect(screen.getByTestId('panel')).toHaveAttribute('data-can-write', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'panel changed' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved!', 'success'))
    await waitFor(() => expect(callsTo(f, CONN).length).toBe(2))
  })

  it('holds a generated push token and opens the gear to show it', async () => {
    routeFetch([[CONN, res(status())]])
    renderAs(<MarketplaceConsole channel="myntra" />)
    await screen.findByText('overview:myntra')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /connection \(/ }))
    fireEvent.click(screen.getByRole('button', { name: 'panel token' }))
    expect(screen.getByTestId('panel')).toHaveTextContent('token:tok_1')
  })
})

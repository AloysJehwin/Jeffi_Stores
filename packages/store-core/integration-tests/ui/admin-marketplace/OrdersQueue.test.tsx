import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import OrdersQueue from '@/components/admin/marketplace/OrdersQueue'
import { renderAs, res, routeFetch, bodyOf, callsTo, stubWide } from './marketplace-kit'

// OrdersQueue: the marketplace order stages (New -> To pack -> Ready to dispatch -> Shipped -> closed).
// Accept / reject / pack / ready-to-dispatch go to the marketplace first; rejecting asks for a reason.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => async () => true, usePrompt: () => async () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/myntra',
  useSearchParams: () => new URLSearchParams(),
}))

const FUTURE = new Date(Date.now() + 5 * 3600_000).toISOString()
const order = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  external_order_id: 'MYN-1',
  order_id: 'o1',
  order_number: '1001',
  items: 'Cordless Drill x1',
  units: 1,
  stock_state: 'ok',
  stock_note: null,
  unmatched: false,
  order_total: '1499',
  status: 'created',
  accept_by: FUTURE,
  dispatch_by: FUTURE,
  packet_id: null,
  tracking_number: null,
  tracking_url: null,
  courier: null,
  manifest_id: null,
  ...over,
})
const counts = { new: 2, to_pack: 1, rtd: 0, shipped: 4, closed: 0 }
const CONSOLE = /\/api\/admin\/[a-z]+\/console/
const ACTION = '/orders/action'

function queue(rows: unknown[] = [order()], c = counts) {
  return routeFetch([
    [CONSOLE, res({ orders: rows, counts: c })],
    [ACTION, res({ ok: true, done: 1, results: [{ id: 'q1', ok: true }] })],
  ])
}

describe('OrdersQueue', () => {
  beforeEach(() => {
    showToast.mockClear()
    stubWide()
  })

  it('loads the New stage, with stage counts and order details', async () => {
    const f = queue([order({ stock_state: 'short', stock_note: 'Only 0 left' })])
    renderAs(<OrdersQueue channel="myntra" />)
    expect(await screen.findByText('MYN-1')).toBeInTheDocument()
    expect(callsTo(f, CONSOLE)[0][0]).toContain('view=orders&bucket=new')
    expect(screen.getByRole('tab', { name: /New\s*2/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Shipped\s*4/ })).toBeInTheDocument()
    expect(screen.getByText('Cordless Drill x1')).toBeInTheDocument()
    expect(screen.getByText('Short on stock')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#1001' })).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1/view'))
    expect(screen.getByText('Accept by')).toBeInTheDocument()
    expect(screen.getByText(/left$/)).toBeInTheDocument()
    expect(screen.getByText('New', { selector: 'span' })).toBeInTheDocument()
  })

  it('shows the empty state for no new orders', async () => {
    queue([])
    renderAs(<OrdersQueue channel="ajio" />)
    expect(await screen.findByText('No new AJIO orders')).toBeInTheDocument()
  })

  it('shows the load error', async () => {
    routeFetch([[CONSOLE, res({ error: 'Portal unreachable' }, false)]])
    renderAs(<OrdersQueue channel="myntra" />)
    expect(await screen.findByText('Portal unreachable')).toBeInTheDocument()
  })

  it('switches stage, reloads it and shows that stage guidance', async () => {
    const f = queue([order({ status: 'accepted' })])
    renderAs(<OrdersQueue channel="ajio" />)
    await screen.findByText('MYN-1')
    fireEvent.click(screen.getByRole('tab', { name: /To pack/ }))
    await waitFor(() => expect(callsTo(f, CONSOLE).at(-1)![0]).toContain('bucket=to_pack'))
    expect(screen.getByText(/Mark orders packed first/)).toBeInTheDocument()
    expect(await screen.findByText('Dispatch by')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Ready to dispatch/ }))
    expect(await screen.findByText(/create a manifest, then hand the packets/)).toBeInTheDocument()
  })

  it('searches after a short debounce', async () => {
    const f = queue()
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: ' MYN-9 ' } })
    await waitFor(() => expect(callsTo(f, CONSOLE).at(-1)![0]).toContain('q=MYN-9'), { timeout: 2000 })
  })

  it('accepts one order and toasts', async () => {
    const f = queue()
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Accepted order MYN-1.', 'success'))
    expect(bodyOf(f, ACTION)).toEqual({ action: 'accept', ids: ['q1'] })
  })

  it('warns when the marketplace fails part of a batch', async () => {
    routeFetch([
      [CONSOLE, res({ orders: [order()], counts })],
      [ACTION, res({ ok: true, done: 0, results: [{ id: 'q1', ok: false, error: 'Already cancelled' }] })],
    ])
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Accepted 0; 1 failed: Already cancelled', 'warning'))
  })

  it('toasts an error when the action request fails', async () => {
    routeFetch([
      [CONSOLE, res({ orders: [order()], counts })],
      [ACTION, res({ error: 'Session expired' }, false)],
    ])
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Session expired', 'error'))
  })

  it('rejects with the chosen reason and closes the dialog', async () => {
    const f = queue()
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Reject Myntra order MYN-1')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Details (optional)'), { target: { value: 'sold elsewhere' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Rejected order MYN-1.', 'success'))
    expect(bodyOf(f, ACTION)).toEqual({ action: 'reject', ids: ['q1'], reason: 'Out of stock: sold elsewhere' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('requires details for the Other reason', async () => {
    queue()
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('combobox'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Other' }))
    const reject = within(dialog).getByRole('button', { name: 'Reject' })
    expect(reject).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'no' } })
    expect(reject).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'duplicate' } })
    expect(reject).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers pack for AJIO but ready-to-dispatch straight from accepted for Myntra', async () => {
    queue([order({ status: 'accepted' })])
    const { unmount } = renderAs(<OrdersQueue channel="ajio" />)
    await screen.findByText('MYN-1')
    expect(screen.getByRole('button', { name: 'Mark packed' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ready to dispatch' })).toBeNull()
    unmount()
    queue([order({ status: 'accepted' })])
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    expect(screen.queryByRole('button', { name: 'Mark packed' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ready to dispatch' })).toBeInTheDocument()
  })

  it('downloads a label document through fetch', async () => {
    const created = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }))
    const f = routeFetch([
      [CONSOLE, res({ orders: [order({ status: 'shipped', accept_by: null })], counts })],
      ['/document?kind=label', res({})],
    ])
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    fireEvent.click(screen.getByRole('button', { name: 'Download label' }))
    await waitFor(() => expect(created).toHaveBeenCalled())
    expect(callsTo(f, '/orders/q1/document?kind=label')).toHaveLength(1)
  })

  it('shows packet and tracking details outside the deadline stages', async () => {
    routeFetch([[CONSOLE, res({ orders: [order({ status: 'shipped', packet_id: 'PK1', tracking_number: 'TRK9', courier: 'Delhivery', tracking_url: 'https://t.test/TRK9', manifest_id: 'MF1' })], counts })]])
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-1')
    fireEvent.click(screen.getByRole('tab', { name: /Shipped/ }))
    expect(await screen.findByText('Packet PK1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'TRK9' })).toHaveAttribute('href', 'https://t.test/TRK9')
    expect(screen.getByText('Manifest MF1')).toBeInTheDocument()
  })

  it('bulk-accepts the selected orders', async () => {
    const f = routeFetch([
      [CONSOLE, res({ orders: [order(), order({ id: 'q2', external_order_id: 'MYN-2' })], counts })],
      [ACTION, res({ ok: true, done: 2, results: [] })],
    ])
    renderAs(<OrdersQueue channel="myntra" />)
    await screen.findByText('MYN-2')
    fireEvent.click(screen.getByLabelText('Select all loaded rows'))
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
    const bulk = screen.getAllByRole('button', { name: /^Accept$/ }).find(b => !b.closest('tr'))!
    fireEvent.click(bulk)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Accepted 2 orders.', 'success'))
    expect(bodyOf(f, ACTION).ids).toEqual(['q1', 'q2'])
  })

  it('hides every write action and selection for a read-only admin', async () => {
    queue()
    renderAs(<OrdersQueue channel="myntra" />, 'reader')
    await screen.findByText('MYN-1')
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(screen.queryByLabelText('Select all loaded rows')).toBeNull()
  })
})

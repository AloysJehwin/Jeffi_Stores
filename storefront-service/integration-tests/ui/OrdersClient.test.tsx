import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let auth: any = { user: { id: 'u1' }, isLoading: false }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
let search = { query: '' }
const register = vi.fn()
vi.mock('@/contexts/AccountSearchContext', () => ({ useAccountSearch: () => ({ query: search.query, register }) }))
vi.mock('@/components/visitor/AccountMobileHeader', () => ({ default: () => <div data-testid="mobile-header" /> }))
vi.mock('@/components/visitor/skeletons/account', () => ({
  OrdersListSkeleton: () => <div role="status">loading orders</div>,
  OrderCardsSkeleton: () => <div role="status">loading cards</div>,
}))

import OrdersClient from '@storefront/app/(storefront)/account/orders/OrdersClient'

const fetchMock = vi.fn()
const orderItem = (id: string, name: string, over: Record<string, any> = {}) => ({
  id, product_id: `p-${id}`, product_name: name, quantity: 2, unit_price: 500, total_price: 1000, buy_mode: 'unit', buy_unit: null,
  products: { slug: `slug-${id}`, product_images: [{ thumbnail_url: `/${id}.png`, is_primary: true }] }, ...over,
})
const order = (id: string, over: Record<string, any> = {}) => ({
  id, order_number: `ORD-${id}`, created_at: '2026-03-05T10:00:00Z', status: 'confirmed', payment_status: 'paid', total_amount: 2500, subtotal: 2500,
  awb_number: null, estimated_delivery_date: null,
  addresses: { address_line1: '12 MG Road', city: 'Pune', state: 'MH', postal_code: '411001' },
  order_items: [orderItem(`${id}a`, 'Halo Speaker')], ...over,
})
const load = (orders: any[], total = orders.length) => fetchMock.mockResolvedValue({ ok: true, json: async () => ({ orders, total }) })

describe('OrdersClient', () => {
  beforeEach(() => {
    for (const m of [push, confirm, register, fetchMock]) m.mockReset()
    auth = { user: { id: 'u1' }, isLoading: false }
    search = { query: '' }
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.useRealTimers())

  it('redirects a signed-out visitor to login and renders nothing', async () => {
    auth = { user: null, isLoading: false }
    const { container } = render(<OrdersClient />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?redirect=/account/orders'))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a skeleton while auth or the first page is loading', async () => {
    auth = { user: null, isLoading: true }
    const a = render(<OrdersClient />)
    expect(screen.getByRole('status')).toHaveTextContent('loading orders')
    expect(push).not.toHaveBeenCalled()
    a.unmount()
    auth = { user: { id: 'u1' }, isLoading: false }
    load([order('1')])
    render(<OrdersClient />)
    expect(screen.getByRole('status')).toHaveTextContent('loading orders')
    await screen.findAllByText('ORD-1')
  })

  it('shows the empty state with a shop link', async () => {
    load([])
    render(<OrdersClient />)
    expect(await screen.findByText('No orders yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start Shopping' })).toHaveAttribute('href', '/products')
  })

  it('lists orders with number, date, total, status and links to the detail page', async () => {
    load([order('1')])
    render(<OrdersClient />)
    const nums = await screen.findAllByText('ORD-1')
    expect(nums.length).toBeGreaterThanOrEqual(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orders?page=1')
    expect(screen.getAllByText('5 Mar 2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText('₹2,500.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /View (Order )?Details/ })[0]).toHaveAttribute('href', '/account/orders/1')
    expect(screen.getByText('12 MG Road')).toBeInTheDocument()
    expect(screen.getByText('Pune, MH 411001')).toBeInTheDocument()
  })

  it('shows items: line total in the desktop card and "+N more" for extras', async () => {
    load([order('1', { order_items: [orderItem('a', 'Speaker'), orderItem('b', 'Cable'), orderItem('c', 'Amp'), orderItem('d', 'Stand')] })])
    render(<OrdersClient />)
    await screen.findAllByText('ORD-1')
    expect(screen.getAllByText('Speaker').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/₹500\.00 × 2 = ₹1,000\.00/, { selector: 'p' }).length).toBeGreaterThan(0)
    expect(screen.getByText('+3 more items')).toBeInTheDocument()
    expect(screen.getByText(/\+2 more items — View all/)).toBeInTheDocument()
  })

  it('weight/length items show a precise quantity with their unit', async () => {
    load([order('1', { order_items: [orderItem('a', 'Wire', { buy_mode: 'length', buy_unit: 'm', quantity: 2.5 })] })])
    render(<OrdersClient />)
    await screen.findAllByText('ORD-1')
    expect(screen.getAllByText(/2\.500 m/).length).toBeGreaterThan(0)
  })

  it('Request Cancellation is only offered for pending/confirmed orders, after confirming', async () => {
    load([order('1', { status: 'shipped' }), order('2', { status: 'pending' })])
    render(<OrdersClient />)
    await screen.findAllByText('ORD-2')
    expect(screen.getAllByRole('button', { name: 'Request Cancellation' })).toHaveLength(2)
    confirm.mockResolvedValueOnce(false)
    fireEvent.click(screen.getAllByRole('button', { name: 'Request Cancellation' })[0])
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Request cancellation?', variant: 'danger' })))
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/cancel'))).toHaveLength(0)
  })

  it('confirming a cancellation posts it and reloads the list', async () => {
    load([order('2', { status: 'pending' })])
    confirm.mockResolvedValue(true)
    render(<OrdersClient />)
    await screen.findAllByText('ORD-2')
    fireEvent.click(screen.getAllByRole('button', { name: 'Request Cancellation' })[0])
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/orders/2/cancel' && c[1].method === 'POST')).toBe(true))
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/orders?page=1').length).toBeGreaterThan(1))
  })

  it('status labels are human readable', async () => {
    load([order('1', { status: 'out_for_delivery' }), order('2', { status: 'cancel_requested' }), order('3', { status: 'return_approved' })])
    render(<OrdersClient />)
    await screen.findAllByText('ORD-1')
    expect(screen.getAllByText('Out for Delivery').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cancellation Requested').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Return Approved').length).toBeGreaterThan(0)
  })

  it('delivery estimate: delivered, delayed and future orders; none for cancelled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-10T06:00:00Z'))
    load([
      order('1', { status: 'delivered', estimated_delivery_date: '2026-03-08' }),
      order('2', { status: 'shipped', estimated_delivery_date: '2026-03-05' }),
      order('3', { status: 'shipped', estimated_delivery_date: '2026-03-20' }),
      order('4', { status: 'cancelled', estimated_delivery_date: '2026-03-20' }),
      order('5', { status: 'out_for_delivery', estimated_delivery_date: '2026-03-10' }),
    ])
    render(<OrdersClient />)
    await screen.findAllByText('ORD-1')
    expect(screen.getAllByText(/Delivered · 8 Mar 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Delayed · 5 Mar 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Est\. 20 Mar 2026/)).toHaveLength(2 * 1)
    expect(screen.getAllByText('Arriving Today').length).toBeGreaterThan(0)
  })

  it('filters by the account search box across number, status and product name', async () => {
    load([order('1', { order_items: [orderItem('a', 'Halo Speaker')] }), order('2', { status: 'shipped', order_items: [orderItem('b', 'Cable')] })])
    const { rerender } = render(<OrdersClient />)
    await screen.findAllByText('ORD-1')
    search = { query: 'cable' }
    rerender(<OrdersClient />)
    expect(screen.queryAllByText('ORD-1')).toHaveLength(0)
    expect(screen.getAllByText('ORD-2').length).toBeGreaterThan(0)
    search = { query: 'shipped' }
    rerender(<OrdersClient />)
    expect(screen.getAllByText('ORD-2').length).toBeGreaterThan(0)
    search = { query: 'zzz' }
    rerender(<OrdersClient />)
    expect(screen.getByText('No orders yet')).toBeInTheDocument()
  })

  it('registers search suggestions (numbers, statuses, products) and the placeholder', async () => {
    load([order('1')])
    render(<OrdersClient />)
    await screen.findAllByText('ORD-1')
    const last = register.mock.calls.at(-1)![0]
    expect(last.placeholder).toBe('Search orders…')
    expect(last.suggestions).toEqual(expect.arrayContaining(['ORD-1', 'Confirmed', 'Halo Speaker']))
  })

  it('shows a Load more control when there are further pages and fetches the next page', async () => {
    load([order('1')], 25)
    render(<OrdersClient />)
    await screen.findAllByText('ORD-1')
    fireEvent.click(await screen.findByRole('button', { name: /Load more/ }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/orders?page=2')).toBe(true))
  })

  it('a failed first load falls back to the empty state', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Server down' }) })
    render(<OrdersClient />)
    expect(await screen.findByText('No orders yet')).toBeInTheDocument()
    expect(screen.queryByText('Server down')).not.toBeInTheDocument()
  })

  it('a failed later page shows a retry row under the orders already loaded', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [order('1')], total: 25 }) })
    render(<OrdersClient />)
    await screen.findAllByText('ORD-1')
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Server down' }) })
    fireEvent.click(await screen.findByRole('button', { name: /Load more/ }))
    expect(await screen.findByText('Server down')).toBeInTheDocument()
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getAllByText('ORD-1').length).toBeGreaterThan(0)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const replace = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/admin/returns',
  useSearchParams: () => sp,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: () => <div>filters</div> }))
vi.mock('@admin/app/(admin)/admin/returns/_components/RequestCardsLoading', () => ({ default: () => <div>cards-loading</div> }))

import AdminReturnsClient from '@admin/app/(admin)/admin/returns/AdminReturnsClient'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  order_id: 'o1',
  order_number: 'ORD-9',
  type: 'refund',
  status: 'received',
  reason: 'damaged',
  description: 'Arrived cracked',
  rvp_awb_number: 'RVP123',
  received_at: '2026-03-03T00:00:00Z',
  image_urls: ['https://cdn.test/p.jpg'],
  valuation_status: null,
  created_at: '2026-03-01T00:00:00Z',
  first_name: 'Asha',
  last_name: 'Rao',
  user_email: 'asha@x.test',
  items: [{ id: 'i1', order_item_id: 'oi1', quantity: 2, unit_price: 500, refund_amount: 1000, product_name: 'Power Drill', variant_name: '18V' }],
  ...over,
})
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('AdminReturnsClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? json(true, {}) : json(true, { returns: [row()], total: 1 })))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists return requests with status, customer, reason, items and total refund', async () => {
    render(asAdmin(<AdminReturnsClient />, ['returns:write']))
    expect(screen.getByText('cards-loading')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '#ORD-9' })).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1/view'))
    expect(String(fetchMock.mock.calls[0][0])).toContain('bucket=all')
    expect(screen.getByText('Received')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Damaged in transit')).toBeInTheDocument()
    expect(screen.getByText('RVP123')).toBeInTheDocument()
    expect(screen.getByText('Power Drill')).toBeInTheDocument()
    expect(screen.getByText(/Total refund: ₹1000/)).toBeInTheDocument()
    expect(screen.getByText('Arrived cracked')).toBeInTheDocument()
  })

  it('switching tabs updates the URL, and History reveals the outcome filter', async () => {
    render(asAdmin(<AdminReturnsClient />))
    await screen.findByRole('link', { name: '#ORD-9' })
    fireEvent.click(screen.getByRole('button', { name: 'Pending approval' }))
    expect(replace).toHaveBeenCalledWith('/admin/returns?bucket=pending_approval', { scroll: false })
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(replace).toHaveBeenLastCalledWith('/admin/returns?bucket=history', { scroll: false })
  })

  it('history tab sends the outcome filter and shows the outcome buttons', async () => {
    sp = new URLSearchParams('bucket=history&outcome=rejected')
    render(asAdmin(<AdminReturnsClient />))
    await screen.findByRole('link', { name: '#ORD-9' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('filter=rejected')
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }))
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('outcome=approved'), { scroll: false })
  })

  it('shows the empty state per tab', async () => {
    fetchMock.mockResolvedValue(json(true, { returns: [], total: 0 }))
    sp = new URLSearchParams('bucket=history&outcome=approved')
    render(asAdmin(<AdminReturnsClient />))
    expect(await screen.findByText('No approved returns')).toBeInTheDocument()
  })

  it('shows the load error', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Backend unavailable' }))
    render(asAdmin(<AdminReturnsClient />))
    expect((await screen.findAllByText('Backend unavailable')).length).toBeGreaterThan(0)
  })

  it('requires a condition before completing a valuation', async () => {
    render(asAdmin(<AdminReturnsClient />, ['returns:write']))
    await screen.findByText('Item Valuation')
    expect(screen.getByRole('button', { name: 'Complete Valuation' })).toBeDisabled()
  })

  it('submits a valuation for a good item with restock and notes', async () => {
    render(asAdmin(<AdminReturnsClient />, ['returns:write']))
    fireEvent.click(await screen.findByRole('button', { name: /Good condition/ }))
    fireEvent.change(screen.getByPlaceholderText(/screen cracked/), { target: { value: '  box dented ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete Valuation' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Valuation saved.', 'success'))
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('/api/admin/returns/r1/valuate')
    expect(JSON.parse(post[1].body)).toEqual({ condition: 'good', notes: 'box dented', restock: true })
  })

  it('does not restock a defective item and toasts a server error', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? json(false, { error: 'Already valuated' }) : json(true, { returns: [row()], total: 1 })))
    render(asAdmin(<AdminReturnsClient />, ['returns:write']))
    fireEvent.click(await screen.findByRole('button', { name: /Defective/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Valuation' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already valuated', 'error'))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'POST')![1].body).restock).toBe(false)
  })

  it('shows a completed valuation instead of the form', async () => {
    fetchMock.mockResolvedValue(json(true, { returns: [row({ valuation_status: 'approved', valuation_condition: 'good', valuated_at: '2026-03-05T00:00:00Z' })], total: 1 }))
    render(asAdmin(<AdminReturnsClient />, ['returns:write']))
    expect(await screen.findByText(/Valuation complete/)).toBeInTheDocument()
    expect(screen.getByText(/will restock/)).toBeInTheDocument()
    expect(screen.queryByText('Item Valuation')).not.toBeInTheDocument()
  })

  it('hides the valuation form without returns write and for non-received items', async () => {
    const { unmount } = render(asMember(<AdminReturnsClient />, ['returns:read']))
    await screen.findByRole('link', { name: '#ORD-9' })
    expect(screen.queryByText('Item Valuation')).not.toBeInTheDocument()
    unmount()
    fetchMock.mockResolvedValue(json(true, { returns: [row({ status: 'approved' })], total: 1 }))
    render(asAdmin(<AdminReturnsClient />, ['returns:write']))
    await screen.findByText('Approved', { selector: 'span' })
    expect(screen.queryByText('Item Valuation')).not.toBeInTheDocument()
  })

  it('opens a customer photo in the lightbox', async () => {
    render(asAdmin(<AdminReturnsClient />))
    fireEvent.click(await screen.findByAltText('Return photo 1'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

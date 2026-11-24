import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const replace = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/admin/replacements',
  useSearchParams: () => sp,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: () => <div>filters</div> }))
vi.mock('@admin/app/(admin)/admin/returns/_components/RequestCardsLoading', () => ({ default: () => <div>cards-loading</div> }))

import AdminReplacementsClient from '@admin/app/(admin)/admin/replacements/AdminReplacementsClient'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  order_id: 'o1',
  order_number: 'ORD-9',
  type: 'replacement',
  status: 'received',
  reason: 'defective',
  description: 'Stopped working',
  rvp_awb_number: 'RVP123',
  return_tracking_number: 'TRK77',
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
const listUrl = () => String(fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/admin/replacements'))![0])

describe('AdminReplacementsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sp = new URLSearchParams()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? json(true, {}) : json(true, { replacements: [row()], total: 1 })))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists replacement requests with customer, reason, tracking, items and value', async () => {
    render(asAdmin(<AdminReplacementsClient />, ['replacements:write']))
    expect(screen.getByText('cards-loading')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '#ORD-9' })).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1/view'))
    expect(listUrl()).toContain('bucket=all')
    expect(listUrl()).toContain('limit=20')
    expect(screen.getByText('Received')).toBeInTheDocument()
    expect(screen.getByText('Replacement')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Defective', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('RVP123')).toBeInTheDocument()
    expect(screen.getByText('TRK77')).toBeInTheDocument()
    expect(screen.getByText('Power Drill')).toBeInTheDocument()
    expect(screen.getByText('Value: ₹1000')).toBeInTheDocument()
    expect(screen.getByText('Stopped working')).toBeInTheDocument()
  })

  it('falls back to the customer name field and Unknown', async () => {
    fetchMock.mockResolvedValue(json(true, {
      replacements: [row({ first_name: null, last_name: null, customer_name: 'Walk-in' }), row({ id: 'r2', first_name: null, last_name: null, customer_name: null })],
    }))
    render(asAdmin(<AdminReplacementsClient />))
    expect(await screen.findByText('Walk-in')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('switching tabs updates the URL, and History reveals the outcome filter', async () => {
    render(asAdmin(<AdminReplacementsClient />))
    await screen.findByRole('link', { name: '#ORD-9' })
    fireEvent.click(screen.getByRole('button', { name: 'Pending approval' }))
    expect(replace).toHaveBeenCalledWith('/admin/replacements?bucket=pending_approval', { scroll: false })
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(replace).toHaveBeenLastCalledWith('/admin/replacements?bucket=history', { scroll: false })
  })

  it('history tab sends the outcome filter and can change it', async () => {
    sp = new URLSearchParams('bucket=history&outcome=rejected')
    render(asAdmin(<AdminReplacementsClient />))
    await screen.findByRole('link', { name: '#ORD-9' })
    expect(listUrl()).toContain('bucket=history')
    expect(listUrl()).toContain('filter=rejected')
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }))
    expect(replace).toHaveBeenCalledWith('/admin/replacements?bucket=history&outcome=approved', { scroll: false })
  })

  it.each([
    ['', 'No active replacement requests'],
    ['bucket=history', 'No completed or rejected replacements'],
    ['bucket=history&outcome=approved', 'No approved replacements'],
    ['bucket=history&outcome=rejected', 'No rejected replacements'],
  ])('empty state for %s', async (query, title) => {
    sp = new URLSearchParams(query)
    fetchMock.mockResolvedValue(json(true, { replacements: [], total: 0 }))
    render(asAdmin(<AdminReplacementsClient />))
    expect(await screen.findByText(title)).toBeInTheDocument()
  })

  it('shows the error state when the list fails to load', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Boom' }))
    render(asAdmin(<AdminReplacementsClient />))
    await waitFor(() => expect(screen.queryByText('cards-loading')).not.toBeInTheDocument())
    expect(screen.queryByRole('link', { name: '#ORD-9' })).not.toBeInTheDocument()
    expect(screen.queryByText('No active replacement requests')).not.toBeInTheDocument()
  })

  it('shows the completed replacement order and rejected note', async () => {
    fetchMock.mockResolvedValue(json(true, {
      replacements: [
        row({ id: 'c1', status: 'completed', replacement_order_id: 'o2', replacement_order_number: 'ORD-10' }),
        row({ id: 'x1', status: 'rejected', admin_notes: 'Out of warranty' }),
      ],
    }))
    render(asAdmin(<AdminReplacementsClient />))
    expect(await screen.findByText(/created and confirmed/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '#ORD-10' })[0]).toHaveAttribute('href', expect.stringContaining('/admin/orders/o2/view'))
    expect(screen.getByText('Rejected: Out of warranty')).toBeInTheDocument()
    expect(screen.queryByText('Item Valuation')).not.toBeInTheDocument()
  })

  it('valuation needs a condition, then posts it with restock for Good', async () => {
    render(asAdmin(<AdminReplacementsClient />, ['replacements:write']))
    await screen.findByText('Item Valuation')
    expect(screen.getByRole('button', { name: 'Complete Valuation' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Good condition/ }))
    fireEvent.change(screen.getByPlaceholderText(/screen cracked/), { target: { value: '  looks fine ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete Valuation' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Valuation saved.', 'success'))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(url).toBe('/api/admin/returns/r1/valuate')
    expect(JSON.parse(init.body)).toEqual({ condition: 'good', notes: 'looks fine', restock: true })
    expect(fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/replacements')).length).toBe(2)
  })

  it('a defective valuation does not restock and omits empty notes', async () => {
    render(asAdmin(<AdminReplacementsClient />, ['replacements:write']))
    await screen.findByText('Item Valuation')
    fireEvent.click(screen.getByRole('button', { name: /^Defective/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Valuation' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Valuation saved.', 'success'))
    const [, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(init.body)).toEqual({ condition: 'defective', restock: false })
  })

  it('toasts the API error when the valuation fails', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) =>
      init?.method === 'POST' ? json(false, { error: 'Already valuated' }) : json(true, { replacements: [row()], total: 1 }))
    render(asAdmin(<AdminReplacementsClient />, ['replacements:write']))
    await screen.findByText('Item Valuation')
    fireEvent.click(screen.getByRole('button', { name: /Damaged/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Valuation' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already valuated', 'error'))
  })

  it('shows a completed valuation instead of the form', async () => {
    fetchMock.mockResolvedValue(json(true, { replacements: [row({ valuation_status: 'approved', valuation_condition: 'good', valuated_at: '2026-03-05T00:00:00Z' })] }))
    render(asAdmin(<AdminReplacementsClient />, ['replacements:write']))
    expect(await screen.findByText(/replacement can be sent/)).toBeInTheDocument()
    expect(screen.queryByText('Item Valuation')).not.toBeInTheDocument()
  })

  it('hides the valuation form without replacements write access', async () => {
    render(asMember(<AdminReplacementsClient />, ['replacements:read']))
    await screen.findByRole('link', { name: '#ORD-9' })
    expect(screen.queryByText('Item Valuation')).not.toBeInTheDocument()
  })

  it('opens a customer photo in a lightbox', async () => {
    render(asAdmin(<AdminReplacementsClient />))
    fireEvent.click(await screen.findByAltText('Photo 1'))
    expect(await screen.findByAltText('Return photo')).toHaveAttribute('src', 'https://cdn.test/p.jpg')
  })
})

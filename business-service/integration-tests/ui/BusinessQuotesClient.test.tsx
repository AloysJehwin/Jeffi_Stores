import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
const push = vi.fn()
const router = { push }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const auth: { user: any; isLoading: boolean } = { user: null, isLoading: false }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/components/business/AccountSidebar', () => ({ BusinessAccountNavBar: () => <div>nav-bar</div> }))
vi.mock('@/components/business/AccountMobileHeader', () => ({ default: () => <div>mobile-header</div> }))
vi.mock('@business/app/(business)/business/quotes/QuotesSkeletons', () => ({
  QuotesListSkeleton: () => <div>list-skeleton</div>,
  QuoteCardsSkeleton: () => <div>cards-skeleton</div>,
}))

import BusinessQuotesClient from '@business/app/(business)/business/quotes/BusinessQuotesClient'

const rfq = (over: Record<string, any> = {}) => ({
  id: 'r1',
  rfq_number: 'RFQ-0001',
  status: 'pending',
  notes: null,
  item_count: 2,
  converted_quotation_id: null,
  quote_number: null,
  quotation_view_token: null,
  quotation_total: null,
  requested_total: '5000',
  created_at: '2026-03-05T10:00:00Z',
  order_id: null,
  invoice_view_token: null,
  invoice_number: null,
  payment_status: null,
  order_status: null,
  invoice_total: null,
  ...over,
})
const respond = (rfqs: any[], total = rfqs.length) => vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ rfqs, total })))

describe('BusinessQuotesClient', () => {
  beforeEach(() => {
    push.mockClear()
    auth.user = { isBusiness: true, approvalStatus: 'approved' }
    auth.isLoading = false
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  it('shows a skeleton while auth loads or before the first page arrives', () => {
    auth.isLoading = true
    render(<BusinessQuotesClient />)
    expect(screen.getByText('list-skeleton')).toBeInTheDocument()
  })

  it('sends buyers who are not approved business accounts back to their account page', async () => {
    auth.user = { isBusiness: false, approvalStatus: 'none' }
    render(<BusinessQuotesClient />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/business/account'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lists quote requests with status, item count, requested value and a details link', async () => {
    respond([rfq({ notes: 'Need by Friday' })])
    render(<BusinessQuotesClient />)
    const link = await screen.findByRole('link', { name: 'RFQ-0001' })
    expect(link).toHaveAttribute('href', '/business/quotes/r1')
    expect(screen.getByText('2 items', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Requested value')).toBeInTheDocument()
    expect(screen.getByText('₹5,000')).toBeInTheDocument()
    expect(screen.getByText('Need by Friday')).toBeInTheDocument()
    expect(screen.getByText('Awaiting review by our team')).toBeInTheDocument()
    expect(screen.getByText('Pending review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View Details/ })).toHaveAttribute('href', '/business/quotes/r1')
    expect(screen.getByText('nav-bar')).toBeInTheDocument()
    expect(screen.getByText('mobile-header')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/business/rfqs?page=1', { credentials: 'include' })
  })

  it('shows the quoted value and a link to the quotation once converted', async () => {
    respond([rfq({ status: 'converted', quotation_total: '4500', quote_number: 'Q-77', quotation_view_token: 'tok/1' })])
    render(<BusinessQuotesClient />)
    expect(await screen.findByText('Quoted value')).toBeInTheDocument()
    expect(screen.getByText('₹4,500')).toBeInTheDocument()
    const quote = screen.getByRole('link', { name: /View Quotation/ })
    expect(quote.getAttribute('href')).toContain('tok%2F1')
    expect(quote).toHaveAttribute('target', '_blank')
    expect(quote).toHaveTextContent('(Q-77)')
    expect(screen.getByText('Quotation issued')).toBeInTheDocument()
  })

  it('shows invoice total, payment status and the invoice link for a quote that became an order', async () => {
    respond([rfq({ status: 'converted', order_id: 'o1', payment_status: 'partial', invoice_total: '8200', invoice_view_token: 'inv1', invoice_number: 'INV-9', order_status: 'confirmed' })])
    render(<BusinessQuotesClient />)
    expect(await screen.findByText('Invoice total')).toBeInTheDocument()
    expect(screen.getByText('₹8,200')).toBeInTheDocument()
    expect(screen.getByText('Partially paid')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View Invoice/ })).toHaveTextContent('(INV-9)')
  })

  it('hides the invoice link while the order is still a draft, and labels unpaid and paid', async () => {
    respond([
      rfq({ id: 'a', rfq_number: 'RFQ-A', order_id: 'o1', payment_status: 'unpaid', invoice_view_token: 'x', order_status: 'draft' }),
      rfq({ id: 'b', rfq_number: 'RFQ-B', order_id: 'o2', payment_status: 'paid', invoice_view_token: 'y', order_status: 'confirmed' }),
    ])
    render(<BusinessQuotesClient />)
    await screen.findByText('RFQ-A')
    expect(screen.getByText('Unpaid')).toBeInTheDocument()
    expect(screen.getByText('Paid')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /View Invoice/ })).toHaveLength(1)
  })

  it('filters by status', async () => {
    respond([
      rfq({ id: 'a', rfq_number: 'RFQ-A', status: 'pending' }),
      rfq({ id: 'b', rfq_number: 'RFQ-B', status: 'rejected' }),
      rfq({ id: 'c', rfq_number: 'RFQ-C', status: 'reviewed' }),
    ])
    render(<BusinessQuotesClient />)
    await screen.findByText('RFQ-A')
    fireEvent.click(screen.getByRole('button', { name: 'Rejected' }))
    expect(screen.queryByText('RFQ-A')).toBeNull()
    expect(screen.getByText('RFQ-B')).toBeInTheDocument()
    expect(screen.getByText('Not accepted')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Negotiating' }))
    expect(screen.getByText('No quotes with this status on this page.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('In progress')).toBeInTheDocument()
  })

  it('shows an empty state with a link to browse products', async () => {
    respond([])
    render(<BusinessQuotesClient />)
    expect(await screen.findByText('No quote requests yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse Products' })).toHaveAttribute('href', '/business/products')
    expect(screen.queryByRole('button', { name: 'Pending' })).toBeNull()
  })

  it('falls back to the empty state when the request fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    render(<BusinessQuotesClient />)
    expect(await screen.findByText('No quote requests yet')).toBeInTheDocument()
  })

  it('pages through results', async () => {
    respond([rfq()], 45)
    render(<BusinessQuotesClient />)
    expect(await screen.findByText('Page 1 of 3 · 45 total')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Page 2 of 3 · 45 total')).toBeInTheDocument()
    expect(fetch).toHaveBeenLastCalledWith('/api/business/rfqs?page=2', { credentials: 'include' })
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Page 1 of 3 · 45 total')).toBeInTheDocument()
  })
})

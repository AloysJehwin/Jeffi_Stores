import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/admin/business/rfqs/r1/view', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: () => <div>changelog</div> }))
vi.mock('@/components/admin/replies/RecordReplies', () => ({ default: () => <div>record-replies</div> }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => null }))
vi.mock('@/components/admin/AutosaveStatusPill', () => ({ default: () => <span>autosave-pill</span> }))
const trigger = vi.fn()
vi.mock('@/hooks/useAutosaveDraft', async orig => ({ ...(await orig<any>()), useAutosaveDraft: () => ({ trigger, flush: vi.fn(), status: 'idle' }) }))
vi.mock('@/lib/client/draft-lock-client', () => ({ assertDraftResponse: vi.fn(async () => {}), lockHeaders: () => ({}) }))
vi.mock('@admin/app/(admin)/admin/business/rfqs/[id]/view/loading', () => ({ default: () => <div>rfq-loading</div> }))

import RFQDetailClient from '@admin/app/(admin)/admin/business/rfqs/[id]/RFQDetailClient'

const rfq = (over: Record<string, unknown> = {}) => ({
  id: 'r1', rfq_number: 'RFQ-100', status: 'pending', notes: 'Need fast delivery', admin_note: null, created_at: '2026-03-01T10:00:00Z',
  converted_quotation_id: null, company_name: 'Acme Builders', first_name: 'Ravi', last_name: 'K', email: 'ravi@acme.test', phone: '9876543210',
  gst_number: '29ABCDE1234F1Z5', user_id: 'u1', quote_number: null, order_id: null, invoice_number: null, invoice_view_token: null,
  order_status: null, invoice_total: null, invoice_payment_status: null, ...over,
})
const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1', description: 'Cordless drill 18V', quantity: 2, unit: 'pc', requested_price: 700, notes: 'Include case', product_name: 'Drill Pro', product_sku: 'DP-1',
  product_image_url: null, base_price: 800, product_mrp: 1000, product_price_ex_gst: 678, product_gst: 18, product_category_id: 'cat1',
  variant_name: '18V Kit', variant_sku: null, variant_price: null, variant_mrp: null, sub_variant_name: null, sub_variant_sku: null,
  sub_variant_price: null, sub_variant_mrp: null, unit_factor: 1, ...over,
})
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
let state: { rfq: any; items: any[]; messages: any[]; draft: any }

const draw = (scopes = ['business_rfqs:write'], role: 'a' | 'm' = 'm') => render((role === 'a' ? asAdmin : asMember)(<RFQDetailClient id="r1" />, scopes))

describe('RFQDetailClient', () => {
  beforeEach(() => {
    state = { rfq: rfq(), items: [item()], messages: [], draft: null }
    showToast.mockReset()
    trigger.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      const m = init?.method || 'GET'
      if (url === '/api/admin/business/rfqs/r1' && m === 'GET') return json(true, { rfq: state.rfq, items: state.items, discountMap: { cat1: 10 } })
      if (url === '/api/admin/business/rfqs/r1' && m === 'PATCH') return json(true, {})
      if (url === '/api/admin/business/rfqs/r1/messages' && m === 'GET') return json(true, { messages: state.messages })
      if (url === '/api/admin/business/rfqs/r1/messages' && m === 'POST') return json(true, { message: { id: 'm9', sender: 'admin', message: JSON.parse(init.body).message, counter_items: JSON.parse(init.body).counter_items, created_at: '2026-03-02T10:00:00Z' } })
      if (url === '/api/admin/business/rfqs/r1/reply-draft' && m === 'GET') return json(true, { draft: state.draft })
      if (url === '/api/admin/business/rfqs/r1/convert-to-quotation') return json(true, { quotationId: 'q1', quoteNumber: 'QT-5' })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the loading view, then header, requested items and the pricing breakdown', async () => {
    draw()
    expect(screen.getByText('rfq-loading')).toBeInTheDocument()
    expect(await screen.findByText('RFQ-100')).toBeInTheDocument()
    expect(screen.getByText('Pending Review')).toBeInTheDocument()
    expect(screen.getAllByText('Acme Builders').length).toBeGreaterThan(0)
    expect(screen.getByText('Cordless drill 18V')).toBeInTheDocument()
    expect(screen.getByText('Drill Pro — 18V Kit')).toBeInTheDocument()
    expect(screen.getByText('Include case')).toBeInTheDocument()
    expect(screen.getByText('20% off MRP')).toBeInTheDocument()
    expect(screen.getByText('10% off customer price')).toBeInTheDocument()
    expect(screen.getByText('3% off business price')).toBeInTheDocument()
    expect(screen.getByText('₹720.00')).toBeInTheDocument()
    expect(screen.getAllByText('₹1,400.00').length).toBeGreaterThan(0)
    expect(screen.getByText('+91 9876543210')).toBeInTheDocument()
    expect(screen.getByText('Need fast delivery')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View customer profile' })).toHaveAttribute('href', expect.stringContaining('/admin/business/customers/u1/view'))
  })

  it('shows not found when the RFQ cannot be loaded', async () => {
    state.rfq = null
    draw()
    expect(await screen.findByText('RFQ not found.')).toBeInTheDocument()
  })

  it('flags an at-or-above-price request and shows empty items', async () => {
    state.items = [item({ requested_price: 900 })]
    const { unmount } = draw()
    expect(await screen.findByText(/At\/above business price/)).toBeInTheDocument()
    unmount()
    state.items = []
    draw()
    expect(await screen.findByText('No items found.')).toBeInTheDocument()
  })

  it('marks a pending RFQ as reviewed with the PATCH body', async () => {
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Reviewed' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Marked as reviewed', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({ status: 'reviewed', adminNote: '' })
    expect(await screen.findByText('Reviewed')).toBeInTheDocument()
  })

  it('rejects with a reason after opening the reject form', async () => {
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    fireEvent.change(screen.getByPlaceholderText(/Reason for rejection/), { target: { value: 'Out of range' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('RFQ rejected', 'success'))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ status: 'rejected', adminNote: 'Out of range' })
    expect(await screen.findByText('Admin note')).toBeInTheDocument()
  })

  it('toasts when a status change fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'PATCH') return json(false)
      if (url === '/api/admin/business/rfqs/r1') return json(true, { rfq: state.rfq, items: state.items, discountMap: {} })
      return json(true, { messages: [], draft: null })
    })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Reviewed' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Action failed', 'error'))
  })

  it('converts a reviewed RFQ to a quotation after the confirmation dialog', async () => {
    state.rfq = rfq({ status: 'reviewed' })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to Quotation' }))
    expect(await screen.findByText('Convert to Quotation?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Quotation QT-5 created', 'success'))
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/business/rfqs/r1/convert-to-quotation' && c[1]?.method === 'POST')).toBe(true)
    expect(await screen.findByRole('link', { name: /View Quotation/ })).toHaveAttribute('href', expect.stringContaining('/admin/quotations/q1/view'))
  })

  it('shows the accepted-offer banner and hides the reply composer', async () => {
    state.rfq = rfq({ status: 'offer_accepted' })
    draw()
    expect(await screen.findByText('Customer accepted the offer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Convert to Quotation ✓' })).toBeInTheDocument()
    expect(screen.queryByText('Negotiation thread')).not.toBeInTheDocument()
  })

  it('shows converted links to the invoice and quotation with payment status', async () => {
    state.rfq = rfq({ status: 'converted', converted_quotation_id: 'q1', quote_number: 'QT-5', order_id: 'o1', invoice_number: 'INV-2', order_status: 'confirmed', invoice_total: '12500', invoice_payment_status: 'partial' })
    draw()
    expect(await screen.findByText('Converted to quotation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Invoice (INV-2)' })).toHaveAttribute('href', expect.stringContaining('/admin/invoices/o1/view'))
    expect(screen.getByText('Partially paid')).toBeInTheDocument()
    expect(screen.getByText('₹12,500')).toBeInTheDocument()
  })

  it('early-stage quick reply: a preset fills the message and sending posts it', async () => {
    draw()
    await screen.findByText('Quick Replies')
    fireEvent.click(screen.getByRole('button', { name: "We've received your request and are reviewing it." }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Reply sent', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0].endsWith('/messages') && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ message: "We've received your request and are reviewing it.", counter_items: null })
    expect(await screen.findByText('Negotiating')).toBeInTheDocument()
  })

  it('negotiation: lists the thread with counter prices and sends a reply with a counter offer', async () => {
    state.rfq = rfq({ status: 'negotiating' })
    state.messages = [{ id: 'm1', sender: 'customer', message: 'Can you do 650?', counter_items: [{ rfq_item_id: 'i1', offered_price: 650 }], created_at: '2026-03-01T12:00:00Z' }]
    draw()
    expect(await screen.findByText('Can you do 650?')).toBeInTheDocument()
    expect(screen.getByText('₹650.00/unit')).toBeInTheDocument()
    expect(screen.getByText('1 message')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Attach counter prices (optional)' }))
    fireEvent.change(screen.getByPlaceholderText('650'), { target: { value: '680' } })
    fireEvent.change(screen.getByPlaceholderText(/Type a reply/), { target: { value: 'Best we can do' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Reply' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Reply sent', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0].endsWith('/messages') && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ message: 'Best we can do', counter_items: [{ rfq_item_id: 'i1', offered_price: 680 }] })
    expect(await screen.findByText('Best we can do')).toBeInTheDocument()
  })

  it('Enter sends the reply and Shift+Enter does not', async () => {
    state.rfq = rfq({ status: 'negotiating' })
    draw()
    const box = await screen.findByPlaceholderText(/Type a reply/)
    fireEvent.change(box, { target: { value: 'Hello' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false)
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Reply sent', 'success'))
  })

  it('restores a saved reply draft and discards it', async () => {
    state.rfq = rfq({ status: 'negotiating' })
    state.draft = { message: 'Draft text', counter_prices: {}, show_counter: false }
    draw()
    expect(await screen.findByDisplayValue('Draft text')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(screen.queryByDisplayValue('Draft text')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(c => c[0].endsWith('/reply-draft') && c[1]?.method === 'DELETE')).toBe(true)
  })

  it('toasts the server error when a reply fails', async () => {
    state.rfq = rfq({ status: 'negotiating' })
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.endsWith('/messages') && init?.method === 'POST') return json(false, { error: 'Locked thread' })
      if (url === '/api/admin/business/rfqs/r1') return json(true, { rfq: state.rfq, items: state.items, discountMap: {} })
      return json(true, { messages: [], draft: null })
    })
    draw()
    const box = await screen.findByPlaceholderText(/Type a reply/)
    fireEvent.change(box, { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Reply' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Locked thread', 'error'))
  })

  it('hides action buttons and the composer without write access', async () => {
    draw(['business_rfqs:read'])
    await screen.findByText('RFQ-100')
    expect(screen.queryByRole('button', { name: 'Mark Reviewed' })).not.toBeInTheDocument()
    expect(screen.queryByText('Quick Replies')).not.toBeInTheDocument()
  })
})

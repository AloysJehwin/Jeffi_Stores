import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => '/admin/quotations/q1' }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {} }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: () => <div>changelog</div> }))
vi.mock('@/components/admin/replies/RecordReplies', () => ({ default: ({ canWrite }: any) => <div>replies:{String(canWrite)}</div> }))

import QuotationDetailClient from '@admin/app/(admin)/admin/quotations/[id]/QuotationDetailClient'

const quotation = {
  id: 'q1',
  quote_number: 'QT-2026-001',
  status: 'draft',
  from_rfq: true,
  subtotal: '1000',
  cgst_amount: '90',
  sgst_amount: '90',
  total_amount: '1180',
  quote_date: '2026-03-01',
  notes: 'Valid 15 days',
  consignee_name: 'Acme Pvt Ltd',
  consignee_phone: '9999999999',
  consignee_gstin: '29AAAAA0000A1Z5',
  consignee_addr1: '1 MG Road',
  consignee_city: 'Bengaluru',
  buyer_same: false,
  buyer_name: 'Beta Traders',
  customer_response: 'accepted',
  converted_order_id: null,
}
const items = [
  { product_id: 'p1', description: 'Drill', hsn_code: '8467', gst_rate: '18', unit: 'PCS', quantity: '5', rate: '200', discount_pct: '0', amount: '1000' },
  { product_id: null, description: 'Custom bracket', gst_rate: '18', quantity: '1', rate: '0', amount: '0' },
]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('QuotationDetailClient', () => {
  beforeEach(() => {
    confirm.mockResolvedValue(true)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(json(true, { quotation, items }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the quotation, items, totals, consignee and buyer', async () => {
    render(asAdmin(<QuotationDetailClient id="q1" />))
    expect((await screen.findAllByText('QT-2026-001')).length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/quotations/q1')
    expect(screen.getAllByText('Drill').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Custom – not in inventory').length).toBeGreaterThan(0)
    expect(screen.getByText('Customer accepted')).toBeInTheDocument()
    expect(screen.getAllByText(/1,180/).length).toBeGreaterThan(0)
    expect(screen.getByText('CGST')).toBeInTheDocument()
    expect(screen.getByText('Acme Pvt Ltd')).toBeInTheDocument()
    expect(screen.getByText('Beta Traders')).toBeInTheDocument()
    expect(screen.getByText('Valid 15 days')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download PDF/ })).toHaveAttribute('href', '/api/admin/quotations/q1/pdf')
  })

  it('recomputes totals from the items when the stored subtotal is zero', async () => {
    fetchMock.mockResolvedValue(json(true, { quotation: { ...quotation, subtotal: '0', cgst_amount: '0', sgst_amount: '0', total_amount: '0' }, items }))
    render(asAdmin(<QuotationDetailClient id="q1" />))
    await screen.findAllByText('QT-2026-001')
    // 1000 + 90 + 90
    expect(screen.getAllByText(/1,180/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/90/).length).toBeGreaterThan(0)
  })

  it('finalizes an RFQ draft after confirming and shows the new status', async () => {
    render(asAdmin(<QuotationDetailClient id="q1" />))
    fetchMock.mockResolvedValueOnce(json(true, { quotation: { ...quotation, status: 'final' } }))
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize Quotation' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Finalize Quotation' })).not.toBeInTheDocument())
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Finalize Quotation?' }))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(patch[0]).toBe('/api/admin/quotations/q1')
    expect(JSON.parse(patch[1].body)).toEqual({ status: 'final' })
    expect(screen.getAllByText('Final').length).toBeGreaterThan(0)
  })

  it('toasts when finalizing fails', async () => {
    render(asAdmin(<QuotationDetailClient id="q1" />))
    fetchMock.mockResolvedValueOnce(json(false, { error: 'Customer email missing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize Quotation' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Customer email missing', 'error'))
  })

  it('does not finalize when the confirmation is declined', async () => {
    confirm.mockResolvedValue(false)
    render(asAdmin(<QuotationDetailClient id="q1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize Quotation' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
  })

  it('hides Finalize without quotations write, and offers Edit only for a non-RFQ draft', async () => {
    const { unmount } = render(asMember(<QuotationDetailClient id="q1" />, ['quotations:read']))
    await screen.findAllByText('QT-2026-001')
    expect(screen.queryByRole('button', { name: 'Finalize Quotation' })).not.toBeInTheDocument()
    expect(screen.getByText('replies:false')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    unmount()
    fetchMock.mockResolvedValue(json(true, { quotation: { ...quotation, from_rfq: false }, items }))
    render(asAdmin(<QuotationDetailClient id="q1" />))
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute('href', expect.stringContaining('edit=q1'))
  })

  it('links the converted invoice', async () => {
    fetchMock.mockResolvedValue(json(true, { quotation: { ...quotation, status: 'accepted', converted_order_id: 'o9' }, items }))
    render(asAdmin(<QuotationDetailClient id="q1" />))
    expect((await screen.findAllByRole('link', { name: /View Invoice/ }))[0]).toHaveAttribute('href', expect.stringContaining('/admin/invoices/o9/view'))
  })

  it('shows not found with a link back', async () => {
    fetchMock.mockResolvedValue(json(true, {}))
    render(asAdmin(<QuotationDetailClient id="x" />))
    expect(await screen.findByText('Quotation not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Quotations' })).toBeInTheDocument()
  })
})

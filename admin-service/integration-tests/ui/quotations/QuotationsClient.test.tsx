import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
const back = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace: vi.fn() }),
  usePathname: () => '/admin/quotations',
  useSearchParams: () => sp,
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/hooks/useDraftLock', async orig => ({
  ...(await orig<any>()),
  useDraftLock: () => ({ lock: null, loaded: true, isMine: false, claimable: true, readOnly: false, closed: false, viewers: [], busy: false, unsaved: null, discard: vi.fn(), markLocked: vi.fn() }),
}))
vi.mock('@/components/ui/HoverCard', () => ({ default: ({ trigger }: any) => <>{trigger}</> }))
vi.mock('@/components/ui/DatePicker', () => ({ default: ({ value }: any) => <input aria-label="date" value={value} readOnly /> }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: ({ entity }: any) => <div>filters:{entity}</div> }))
vi.mock('@/components/admin/LineItemsSection', async orig => ({ ...(await orig<any>()), default: () => <div>line-items-section</div> }))
vi.mock('@/components/admin/RowActions', () => ({
  default: ({ actions }: any) => (
    <div>
      {actions.filter((a: any) => !a.hidden).map((a: any) => (
        <button key={a.key} onClick={() => a.onSelect?.()}>{a.label}</button>
      ))}
    </div>
  ),
}))
vi.mock('@admin/app/(admin)/admin/quotations/_components/QuotationsMobileList', () => ({ default: () => <div>mobile-list</div> }))

import QuotationsClient from '@admin/app/(admin)/admin/quotations/QuotationsClient'

const quote = (over: Record<string, unknown> = {}) => ({
  id: 'q1', quote_number: 'QT-001', quote_date: '2026-03-01', status: 'final', consignee_name: 'Acme Pvt Ltd', consignee_addr1: '1 MG Road', consignee_addr2: null,
  consignee_city: 'Raipur', consignee_state: 'Chhattisgarh', consignee_gstin: null, consignee_phone: '9999999999', consignee_pincode: '492001',
  consignee_email: 'buy@acme.test', buyer_same: true, notes: null, subtotal: 1000, cgst_amount: 90, sgst_amount: 90, total_amount: 1180,
  converted_order_id: null, view_token: null, from_rfq: false, created_at: '2026-03-01', lock: null, ...over,
})
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()
let quotes: any[]
let detail: any
let batchAvail: any
let convertRes: any

describe('QuotationsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sp = new URLSearchParams()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    quotes = [
      quote(),
      quote({ id: 'q2', quote_number: 'QT-002', status: 'draft', consignee_name: 'Beta Co', consignee_email: null }),
      quote({ id: 'q3', quote_number: 'QT-003', status: 'final', converted_order_id: 'o9', consignee_name: 'Gamma Ltd' }),
    ]
    detail = { items: [] }
    batchAvail = { items: [], serialized_items: [] }
    convertRes = json(true, { orderId: 'o1', savedAsDraft: true, insufficientItems: ['Drill', 'Saw'] })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/quotations?')) return json(true, { quotations: quotes, total: quotes.length })
      if (url.startsWith('/api/admin/inventory/batches/available')) return json(true, batchAvail)
      if (url.endsWith('/convert-to-invoice')) return convertRes
      if (/^\/api\/admin\/quotations\/q\d$/.test(url) && !init?.method) return json(true, detail)
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists quotations with number, date, consignee, total, status and conversion state', async () => {
    render(asAdmin(<QuotationsClient canWrite />))
    expect(screen.getByText('filters:quotations')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'QT-001' })).toHaveAttribute('href', expect.stringContaining('/admin/quotations/q1/view'))
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/admin/quotations?')
    expect(url).toContain('page=1')
    expect(url).toContain('pageSize=25')
    expect(screen.getByText('Acme Pvt Ltd')).toBeInTheDocument()
    expect(screen.getAllByText('₹1,180.00').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Invoiced/ })).toHaveAttribute('href', expect.stringContaining('/admin/invoices/o9/view'))
    expect(screen.getByText('mobile-list')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    quotes = []
    render(asAdmin(<QuotationsClient canWrite />))
    expect(await screen.findByText('No quotations found.')).toBeInTheDocument()
  })

  it('row actions follow status: edit and delete for drafts, email and convert for final', async () => {
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Send email to/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /→ Invoice/ })).toHaveLength(1)
  })

  it('read-only users get no edit, delete or convert actions', async () => {
    render(asMember(<QuotationsClient canWrite={false} />, ['quotations:read']))
    await screen.findByRole('link', { name: 'QT-001' })
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /→ Invoice/ })).not.toBeInTheDocument()
  })

  it('RFQ drafts cannot be edited here', async () => {
    quotes = [quote({ status: 'draft', from_rfq: true })]
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('deleting a draft sends DELETE and removes the row', async () => {
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-002' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'QT-002' })).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/quotations/q2', { method: 'DELETE' })
  })

  it('a failed delete keeps the row and toasts the error', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/quotations?')) return json(true, { quotations: quotes, total: 3 })
      if (init?.method === 'DELETE') return json(false, { error: 'Locked by Priya' }, 423)
      return json(true, {})
    })
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-002' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Locked by Priya', 'error'))
    expect(screen.getByRole('link', { name: 'QT-002' })).toBeInTheDocument()
  })

  it('emails the quotation to the consignee', async () => {
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Send email to buy@acme.test' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Quotation email sent', 'success'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/quotations/q1/resend-email', { method: 'POST', credentials: 'include' })
  })

  it('toasts when the email fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/quotations?')) return json(true, { quotations: quotes, total: 3 })
      if (init?.method === 'POST') return json(false, { error: 'SMTP down' }, 502)
      return json(true, {})
    })
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    fireEvent.click(screen.getAllByRole('button', { name: /Send email to/ })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('SMTP down', 'error'))
  })

  it('clicking a row opens the detail dialog with the consignee', async () => {
    render(asAdmin(<QuotationsClient canWrite />))
    fireEvent.click(await screen.findByText('Acme Pvt Ltd'))
    expect((await screen.findAllByText('Consignee')).length).toBeGreaterThan(1)
    expect(screen.getAllByText('buy@acme.test').length).toBeGreaterThan(0)
  })

  it('New Quotation and Edit open the editor view', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/quotations?')) return json(true, { quotations: quotes, total: 3 })
      if (url === '/api/admin/quotations/q2') return json(true, { quotation: quotes[1], items: [] })
      return json(true, {})
    })
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-002' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('view=editor'), { scroll: false }))
  })

  it('a load failure when opening a quotation for edit is toasted', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/quotations?')) return json(true, { quotations: quotes, total: 3 })
      if (url === '/api/admin/quotations/q2') return json(false, { error: 'Gone' }, 404)
      return json(true, {})
    })
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-002' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Gone'), 'error'))
  })

  it('Convert to invoice asks for a payment mode, posts it and shows the draft notice for short stock', async () => {
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    fireEvent.click(screen.getByRole('button', { name: /→ Invoice/ }))
    expect(await screen.findByText('Payment Mode')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/^Credit/))
    fireEvent.click(screen.getByLabelText(/Enable delivery tracking/))
    fireEvent.click(screen.getByRole('button', { name: 'Convert →' }))
    expect(await screen.findByText('Some items are out of stock')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/convert-to-invoice'))!
    expect(url).toBe('/api/admin/quotations/q1/convert-to-invoice')
    expect(JSON.parse(init.body)).toEqual({ paymentMode: 'credit', enableDelivery: true })
    expect(screen.getByText('Drill')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('not enough stock for 2 item(s)'), 'error')
    expect(screen.getByRole('link', { name: /View Draft Invoice/ })).toHaveAttribute('href', expect.stringContaining('/admin/invoices/o1/view'))
  })

  it('an out-of-stock quotation hides cash and bank transfer', async () => {
    detail = { items: [{ product_id: 'p1', inventory_quantity: '1', quantity: '5', sell_unit_dimension: 'count', sell_unit_factor: '1' }] }
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    fireEvent.click(screen.getByRole('button', { name: /→ Invoice/ }))
    expect(await screen.findByText(/cash and bank transfer options are hidden/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Cash/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Credit/)).toBeChecked()
  })

  it('UPI QR conversion opens a payment QR first and converts nothing until paid', async () => {
    const intent = { intentId: 'pi_1', qrImageUrl: 'https://cdn.test/qr.png', amount: 1180, expiresAt: new Date(Date.now() + 600_000).toISOString() }
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/quotations?')) return json(true, { quotations: quotes, total: quotes.length })
      if (url.startsWith('/api/admin/inventory/batches/available')) return json(true, batchAvail)
      if (url === '/api/admin/payments/qr-intents' && init?.method === 'POST') return json(true, intent)
      if (url === '/api/admin/payments/qr-intents/pi_1') return json(true, { status: 'pending' })
      if (/^\/api\/admin\/quotations\/q\d$/.test(url) && !init?.method) return json(true, detail)
      return json(true, {})
    })
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    fireEvent.click(screen.getByRole('button', { name: /→ Invoice/ }))
    fireEvent.click(await screen.findByLabelText(/^UPI QR/))
    fireEvent.click(screen.getByRole('button', { name: 'Show payment QR' }))
    expect(await screen.findByAltText('UPI QR code')).toHaveAttribute('src', 'https://cdn.test/qr.png')
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/payments/qr-intents')!
    expect(JSON.parse(post[1].body)).toEqual({ kind: 'quotation_convert', payload: { quotationId: 'q1', paymentMode: 'upi_qr', enableDelivery: false } })
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/convert-to-invoice'))).toBe(false)
    expect(screen.queryByText('Payment Mode')).not.toBeInTheDocument()
  })

  it('a UPI QR intent failure is toasted and the dialog stays open', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/quotations?')) return json(true, { quotations: quotes, total: quotes.length })
      if (url.startsWith('/api/admin/inventory/batches/available')) return json(true, batchAvail)
      if (url === '/api/admin/payments/qr-intents') return json(false, { error: 'Insufficient stock for Drill' }, 409)
      if (/^\/api\/admin\/quotations\/q\d$/.test(url) && !init?.method) return json(true, detail)
      return json(true, {})
    })
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    fireEvent.click(screen.getByRole('button', { name: /→ Invoice/ }))
    fireEvent.click(await screen.findByLabelText(/^UPI QR/))
    fireEvent.click(screen.getByRole('button', { name: 'Show payment QR' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Insufficient stock for Drill', 'error'))
    expect(screen.getByText('Payment Mode')).toBeInTheDocument()
  })

  it('a conversion failure is toasted and the dialog stays open', async () => {
    convertRes = json(false, { error: 'Already converted' }, 409)
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    fireEvent.click(screen.getByRole('button', { name: /→ Invoice/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Convert →' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Already converted'), 'error'))
    expect(screen.getByText('Payment Mode')).toBeInTheDocument()
  })

  it('batch products move conversion to the stock-assignment step first', async () => {
    batchAvail = {
      items: [{ order_item_id: 'oi1', product_name: 'Milk', required_qty: 2, already_assigned: false, batches: [{ id: 'b1', lot_number: 'L1', quantity_remaining: 5 }] }],
      serialized_items: [],
    }
    render(asAdmin(<QuotationsClient canWrite />))
    await screen.findByRole('link', { name: 'QT-001' })
    fireEvent.click(screen.getByRole('button', { name: /→ Invoice/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Convert →' }))
    expect(await screen.findByText('Assign Stock')).toBeInTheDocument()
    expect(screen.getByText('Select batches — quantities auto-filled (FIFO)')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/convert-to-invoice'))).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/inventory/batches/available?quotation_id=q1', { credentials: 'include' })
  })

  describe('drafts section', () => {
    it('loads only drafts and shows the empty state', async () => {
      quotes = []
      render(asAdmin(<QuotationsClient canWrite section="drafts" />))
      expect(await screen.findByText('No draft quotations.')).toBeInTheDocument()
      const url = String(fetchMock.mock.calls[0][0])
      expect(url).toContain('status=draft')
      expect(screen.queryByText('filters:quotations')).not.toBeInTheDocument()
    })

    it('lists the drafts returned by the server', async () => {
      quotes = [quote({ id: 'q2', quote_number: 'QT-002', status: 'draft', consignee_name: 'Beta Co', lock: { ownerId: 'a1', ownerName: 'Priya', lastActiveAt: new Date().toISOString(), mine: false } })]
      render(asAdmin(<QuotationsClient canWrite section="drafts" />))
      expect(await screen.findByRole('link', { name: 'QT-002' })).toBeInTheDocument()
      expect(screen.getByText('Beta Co')).toBeInTheDocument()
      expect(screen.getByText('Priya')).toBeInTheDocument()
    })
  })
})

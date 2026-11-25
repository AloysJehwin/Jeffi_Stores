import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
const back = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace: vi.fn() }),
  usePathname: () => '/admin/invoices',
  useSearchParams: () => sp,
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/hooks/useDraftLock', async orig => ({
  ...(await orig<any>()),
  useDraftLock: () => ({ lock: null, loaded: true, isMine: false, claimable: true, readOnly: false, closed: false, viewers: [], busy: false, unsaved: null, discard: vi.fn(), markLocked: vi.fn() }),
}))
vi.mock('@/components/ui/HoverCard', () => ({ default: ({ trigger }: any) => <>{trigger}</> }))
vi.mock('@/components/ui/DatePicker', () => ({ default: ({ value }: any) => <input aria-label="date" value={value} readOnly /> }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: ({ entity }: any) => <div>filters:{entity}</div> }))
vi.mock('@/components/admin/LineItemsSection', async orig => ({
  ...(await orig<any>()),
  default: ({ items, onChange }: any) => (
    <div>
      line-items-section
      <button type="button" onClick={() => onChange([{ ...items[0], product_name: 'Drill', unit_price: '1180', quantity: 2, gst_rate: 18, inventory_quantity: null }])}>fill-line</button>
    </div>
  ),
}))
vi.mock('@/components/admin/BatchPickerModal', () => ({
  default: ({ items, onConfirm, onCancel }: any) => (
    <div>
      batch-picker:{items.length}
      <button onClick={() => onConfirm([{ order_item_id: 'oi1', batch_id: 'b1', qty: 2 }])}>confirm-batch</button>
      <button onClick={onCancel}>cancel-batch</button>
    </div>
  ),
}))
vi.mock('@/components/admin/SerialEntryModal', () => ({
  default: () => <div>serial-modal</div>,
  SerialPicker: () => null,
}))
vi.mock('@/components/admin/RowActions', () => ({
  default: ({ actions }: any) => (
    <div>
      {actions.filter((a: any) => !a.hidden).map((a: any) => (
        <button key={a.key} onClick={() => a.onSelect?.()}>{a.label}</button>
      ))}
    </div>
  ),
}))
vi.mock('@admin/app/(admin)/admin/invoices/_components/InvoicesMobileList', () => ({ default: () => <div>mobile-list</div> }))

import InvoicesClient from '@admin/app/(admin)/admin/invoices/InvoicesClient'

const inv = (over: Record<string, unknown> = {}) => ({
  id: 'i1', order_number: 'ORD-1', invoice_number: 'INV-100', invoice_date: '2026-02-01', customer_name: 'Asha Rao', customer_phone: '9999999999',
  customer_email: 'asha@x.test', total_amount: '1180', taxable_amount: '1000', cgst_amount: '90', sgst_amount: '90', igst_amount: '0', payment_status: 'paid',
  status: 'confirmed', source: 'offline', buyer_gstin: '29AAAAA0000A1Z5', irn: null, irn_status: null, eway_bill_no: null, pdf_url: null, ...over,
})
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'd1', order_number: 'ORD-D1', customer_name: 'Draft Cust', customer_phone: '8888888888', total_amount: '500', source: 'offline', created_at: '2026-02-03',
  total_items: 3, short_items: 0, out_of_stock_items: 0, ...over,
})
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()
let invoices: any[]
let drafts: any[]
let batchAvail: any

describe('InvoicesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sp = new URLSearchParams()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    invoices = [inv(), inv({ id: 'i2', invoice_number: 'INV-101', customer_name: 'Beta', source: 'online', payment_status: 'unpaid', customer_email: '', irn: 'IRN1', irn_status: 'generated' }),
      inv({ id: 'i3', invoice_number: 'INV-102', status: 'cancelled', customer_name: 'Gamma' })]
    drafts = [draft(), draft({ id: 'd2', order_number: 'AMD-9', source: 'offline', total_items: 2, short_items: 1, out_of_stock_items: 1 })]
    batchAvail = { items: [], serialized_items: [] }
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/invoices?')) return json(true, { invoices, total: invoices.length })
      if (url === '/api/admin/invoices/drafts' && !init?.method) return json(true, { drafts })
      if (url.startsWith('/api/admin/inventory/batches/available')) return json(true, batchAvail)
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists invoices with number, customer, amount, payment, source, IRN and cancelled badges', async () => {
    render(asAdmin(<InvoicesClient canWrite />))
    expect(screen.getByText('filters:invoices')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'INV-100' })).toHaveAttribute('href', expect.stringContaining('/admin/invoices/i1/view'))
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/invoices?page=1')
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getAllByText('₹1,180.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Taxable ₹1,000.00', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('IRN').length).toBeGreaterThan(1)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText('mobile-list')).toBeInTheDocument()
  })

  it('shows the empty state when no invoice matches', async () => {
    invoices = []
    render(asAdmin(<InvoicesClient canWrite />))
    expect(await screen.findByText('No invoices found.')).toBeInTheDocument()
  })

  it('clicking a row opens the detail dialog and Escape closes it', async () => {
    render(asAdmin(<InvoicesClient canWrite />))
    fireEvent.click(await screen.findByText('Asha Rao'))
    expect(await screen.findByText('Taxable')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Taxable', { selector: 'dt, span, div' })).not.toBeInTheDocument())
  })

  it('offers edit and cancel only for live offline invoices; cancel posts and reloads', async () => {
    render(asAdmin(<InvoicesClient canWrite />))
    await screen.findByRole('link', { name: 'INV-100' })
    expect(screen.getAllByRole('button', { name: 'Edit Invoice' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Cancel Invoice' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Invoice' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invoice INV-100 cancelled', 'success'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/orders/i1/cancel', { method: 'POST', credentials: 'include' })
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/invoices?')).length).toBe(2))
  })

  it('toasts the server error when cancelling fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/invoices?')) return json(true, { invoices, total: 3 })
      if (init?.method === 'POST') return json(false, { error: 'Already shipped' }, 400)
      return json(true, {})
    })
    render(asAdmin(<InvoicesClient canWrite />))
    await screen.findByRole('link', { name: 'INV-100' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Invoice' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already shipped', 'error'))
  })

  it('emails the invoice to the customer only when an email exists', async () => {
    render(asAdmin(<InvoicesClient canWrite />))
    await screen.findByRole('link', { name: 'INV-100' })
    expect(screen.getAllByRole('button', { name: /Send email to/ })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Send email to asha@x.test' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Email sent successfully', 'success'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/invoices/i1/resend-email', { method: 'POST', credentials: 'include' })
  })

  it('cash sales link to the cash-sale page and offer a receipt instead', async () => {
    invoices = [inv({ id: 'c1', invoice_number: 'CS-1', source: 'cash_sale' })]
    render(asAdmin(<InvoicesClient canWrite />))
    expect(await screen.findByRole('link', { name: 'CS-1' })).toHaveAttribute('href', expect.stringContaining('/admin/cash-sale/c1/view'))
    expect(screen.getByRole('button', { name: 'Download Receipt PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Invoice' })).not.toBeInTheDocument()
  })

  it('opens the offline editor from the row action by pushing view=edit', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/invoices?')) return json(true, { invoices, total: 3 })
      if (url === '/api/admin/orders/i1') return json(true, { order: {}, items: [] })
      return json(true, {})
    })
    render(asAdmin(<InvoicesClient canWrite />))
    await screen.findByRole('link', { name: 'INV-100' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Invoice' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('view=edit&edit=i1'), { scroll: false }))
  })

  it('shows the new-invoice form for ?view=create', async () => {
    sp = new URLSearchParams('view=create')
    render(asAdmin(<InvoicesClient canWrite />))
    expect(await screen.findByText('New Offline Invoice')).toBeInTheDocument()
    expect(screen.getByText('line-items-section')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Invoice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeInTheDocument()
  })

  it('UPI QR shows a "Show payment QR" action that opens the QR and creates no invoice', async () => {
    sp = new URLSearchParams('view=create')
    const intent = { intentId: 'pi_1', qrImageUrl: 'https://cdn.test/qr.png', amount: 2360, expiresAt: new Date(Date.now() + 600_000).toISOString() }
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/invoices?')) return json(true, { invoices, total: invoices.length })
      if (url === '/api/admin/invoices/drafts' && !init?.method) return json(true, { drafts })
      if (url === '/api/admin/payments/qr-intents' && init?.method === 'POST') return json(true, intent)
      if (url === '/api/admin/payments/qr-intents/pi_1') return json(true, { status: 'pending' })
      return json(true, {})
    })
    render(asAdmin(<InvoicesClient canWrite />))
    await screen.findByText('New Offline Invoice')
    const fill = (label: RegExp, v: string) => fireEvent.change(screen.getByText(label).closest('div')!.querySelector('input')!, { target: { value: v } })
    fill(/^Name/, 'Asha Rao')
    fill(/^Phone/, '9999999999')
    fill(/^Address Line 1/, '1 MG Road')
    fill(/^City/, 'Bengaluru')
    fireEvent.click(screen.getByText('fill-line'))
    fireEvent.click(screen.getByLabelText(/UPI \(QR Scan\)/))
    fireEvent.click(screen.getByRole('button', { name: 'Show payment QR' }))
    expect(await screen.findByAltText('UPI QR code')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/payments/qr-intents')!
    const body = JSON.parse(post[1].body)
    expect(body.kind).toBe('invoice')
    expect(body.payload).toMatchObject({ customerName: 'Asha Rao', paymentMode: 'upi_qr' })
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/orders/create')).toBe(false)
  })

  it('hides the create form actions without write access', async () => {
    sp = new URLSearchParams('view=create')
    render(asMember(<InvoicesClient canWrite={false} />, ['invoices:read']))
    expect(await screen.findByText('New Offline Invoice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create Invoice' })).not.toBeInTheDocument()
  })

  describe('drafts section', () => {
    it('lists drafts with type badges and the stock pill, and does not list invoices', async () => {
      render(asAdmin(<InvoicesClient canWrite section="drafts" />))
      expect(await screen.findAllByText('ORD-D1')).not.toHaveLength(0)
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/invoices/drafts', { credentials: 'include' })
      expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/admin/invoices?'))).toBe(false)
      expect(screen.getAllByText('Amendment Draft').length).toBeGreaterThan(0)
      expect(screen.getAllByText('All 3 in stock').length).toBeGreaterThan(0)
      expect(screen.getAllByText('1 of 2 out of stock').length).toBeGreaterThan(0)
      expect(screen.queryByText('filters:invoices')).not.toBeInTheDocument()
    })

    it('shows the empty drafts state', async () => {
      drafts = []
      render(asAdmin(<InvoicesClient canWrite section="drafts" />))
      expect(await screen.findByText('No draft invoices.')).toBeInTheDocument()
    })

    it('Finalize posts the draft and reports the invoice number', async () => {
      fetchMock.mockImplementation(async (url: string, init?: any) => {
        if (url === '/api/admin/invoices/drafts' && !init?.method) return json(true, { drafts })
        if (url.startsWith('/api/admin/inventory/batches/available')) return json(true, batchAvail)
        if (url.endsWith('/finalize')) return json(true, { invoiceNumber: 'INV-200' })
        return json(true, {})
      })
      render(asAdmin(<InvoicesClient canWrite section="drafts" />))
      fireEvent.click((await screen.findAllByRole('button', { name: 'Finalize' }))[0])
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invoice INV-200 finalized', 'success'))
      const [url, init] = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/finalize'))!
      expect(url).toBe('/api/admin/invoices/drafts/d1/finalize')
      expect(JSON.parse(init.body)).toEqual({ batch_assignments: [], serial_assignments: [] })
    })

    it('a draft with perishable lines asks for batches first, then finalizes with the assignments', async () => {
      batchAvail = { items: [{ order_item_id: 'oi1', batches: [] }], serialized_items: [] }
      fetchMock.mockImplementation(async (url: string, init?: any) => {
        if (url === '/api/admin/invoices/drafts' && !init?.method) return json(true, { drafts })
        if (url.startsWith('/api/admin/inventory/batches/available')) return json(true, batchAvail)
        if (url.endsWith('/finalize')) return json(true, { invoiceNumber: 'INV-201' })
        return json(true, {})
      })
      render(asAdmin(<InvoicesClient canWrite section="drafts" />))
      fireEvent.click((await screen.findAllByRole('button', { name: 'Finalize' }))[0])
      expect(await screen.findByText('batch-picker:1')).toBeInTheDocument()
      expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/finalize'))).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: 'confirm-batch' }))
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invoice INV-201 finalized', 'success'))
      const [, init] = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/finalize'))!
      expect(JSON.parse(init.body).batch_assignments).toEqual([{ order_item_id: 'oi1', batch_id: 'b1', qty: 2 }])
    })

    it('toasts the API error when finalizing fails', async () => {
      fetchMock.mockImplementation(async (url: string, init?: any) => {
        if (url === '/api/admin/invoices/drafts' && !init?.method) return json(true, { drafts })
        if (url.startsWith('/api/admin/inventory/batches/available')) return json(true, batchAvail)
        if (url.endsWith('/finalize')) return json(false, { error: 'Not enough stock' }, 400)
        return json(true, {})
      })
      render(asAdmin(<InvoicesClient canWrite section="drafts" />))
      fireEvent.click((await screen.findAllByRole('button', { name: 'Finalize' }))[0])
      await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Not enough stock'), 'error'))
    })

    it('an amendment draft publishes onto its original', async () => {
      fetchMock.mockImplementation(async (url: string, init?: any) => {
        if (url === '/api/admin/invoices/drafts' && !init?.method) return json(true, { drafts })
        if (url.endsWith('/publish')) return json(true, { invoiceNumber: 'INV-100' })
        return json(true, {})
      })
      render(asAdmin(<InvoicesClient canWrite section="drafts" />))
      fireEvent.click((await screen.findAllByRole('button', { name: 'Publish Amendment' }))[0])
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Amendment published as INV-100', 'success'))
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/invoices/drafts/d2/publish', { method: 'POST', credentials: 'include' })
    })

    it('read-only users see no Finalize, Edit or Publish actions', async () => {
      render(asMember(<InvoicesClient canWrite={false} section="drafts" />, ['invoices:read']))
      await screen.findAllByText('ORD-D1')
      expect(screen.queryByRole('button', { name: 'Finalize' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Publish Amendment' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
const replace = vi.fn()
const router = { push, replace }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/invoices/i1/view',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Jeffi' } }) }))
vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {} }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: () => <div>changelog</div> }))
vi.mock('@/components/admin/replies/RecordReplies', () => ({ default: ({ canWrite }: any) => <div>replies:{String(canWrite)}</div> }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => null }))

import InvoiceDetailClient from '@admin/app/(admin)/admin/invoices/[id]/InvoiceDetailClient'

const order: any = {
  id: 'o1', invoice_number: 'INV-100', order_number: 'ORD-9', status: 'confirmed', source: 'offline', payment_status: 'unpaid', payment_mode: 'cash',
  invoice_date: '2026-02-01', subtotal: '1000', discount_amount: '50', business_discount_amount: '0', shipping_amount: '40',
  cgst_amount: '90', sgst_amount: '90', is_igst: false, total_amount: '1180', notes: 'Deliver soon',
  customer_name: 'Asha Rao', customer_phone: '9999999999', customer_email: 'asha@x.test', buyer_gstin: '29AAAAA0000A1Z5',
  address_line1: '1 MG Road', city: 'Bengaluru', state: 'KA', postal_code: '560001',
  irn: 'IRN1', irn_status: 'generated', eway_bill_no: 'EW123', tracking_number: 'TRK1', shipping_method: 'courier', updated_at: '2026-02-02',
}
const items = [
  { product_id: 'p1', product_name: 'Drill', product_sku: 'DR-1', hsn_code: '8467', gst_rate: '18', quantity: '2', unit_price: '500', taxable_amount: '1000', tax_amount: '180', total_price: '1180', discount_amount: '0' },
  { product_id: null, product_name: 'Custom bracket', gst_rate: '12', quantity: '1', unit_price: '0', total_price: '0', discount_amount: '25' },
]
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()
let detail: any
let amendment: any

function setup(over: Partial<typeof order> = {}) {
  detail = { order: { ...order, ...over }, items }
}

describe('InvoiceDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setup()
    amendment = { draft: null }
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/invoices/i1/detail') return json(true, detail)
      if (url === '/api/admin/invoices/i1/amendment-draft' && !init?.method) return json(true, amendment)
      return json(true)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the invoice, line items, totals, customer, shipping and tax details', async () => {
    render(asAdmin(<InvoiceDetailClient id="i1" />, ['invoices:write']))
    expect(await screen.findByText('Invoice #INV-100')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/invoices/i1/detail')
    expect(screen.getAllByText('Drill').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Custom – not in inventory').length).toBeGreaterThan(0)
    expect(screen.getByText('Coupon discount')).toBeInTheDocument()
    expect(screen.getAllByText('Shipping').length).toBeGreaterThan(0)
    expect(screen.getByText('CGST')).toBeInTheDocument()
    expect(screen.getByText('SGST')).toBeInTheDocument()
    expect(screen.queryByText('IGST')).not.toBeInTheDocument()
    expect(screen.getByText('Deliver soon')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('1 MG Road, Bengaluru, KA, 560001')).toBeInTheDocument()
    expect(screen.getByText('EW123')).toBeInTheDocument()
    expect(screen.getByText('Generated')).toBeInTheDocument()
    expect(screen.getByText('TRK1')).toBeInTheDocument()
    expect(screen.getByText('replies:true')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download PDF/ })).toHaveAttribute('href', '/api/orders/o1/invoice')
    expect(screen.getByRole('link', { name: /View Order/ })).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1/view'))
  })

  it('shows IGST instead of CGST/SGST for an inter-state invoice, and the IRN stub', async () => {
    setup({ is_igst: true, igst_amount: '180', irn_status: 'pending' })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    expect(await screen.findByText('IGST')).toBeInTheDocument()
    expect(screen.queryByText('CGST')).not.toBeInTheDocument()
    expect(screen.getByText('Stub')).toBeInTheDocument()
  })

  it('shows the not-found state when there is no order', async () => {
    detail = {}
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    expect(await screen.findByText('Invoice not found.')).toBeInTheDocument()
  })

  it('follows a redirect from the detail endpoint', async () => {
    detail = { redirect: '/admin/orders/o1/view' }
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/orders/o1/view'))
  })

  it('offers Amend Invoice for a finalized offline invoice and opens the new draft', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/invoices/i1/detail') return json(true, detail)
      if (init?.method === 'POST') return json(true, { draftId: 'd9' })
      return json(true, amendment)
    })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Amend Invoice' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/invoices/d9/view')))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/invoices/i1/amendment-draft', { method: 'POST', credentials: 'include' })
  })

  it('reuses an existing amendment draft on 409 and toasts info for a 423 lock', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/invoices/i1/detail') return json(true, detail)
      if (init?.method === 'POST') return json(false, { draftId: 'd7', error: 'Held by Priya' }, 423)
      return json(true, amendment)
    })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Amend Invoice' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/invoices/d7/view')))
    expect(showToast).toHaveBeenCalledWith('Held by Priya', 'info')
  })

  it('toasts when creating the amendment draft fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/invoices/i1/detail') return json(true, detail)
      if (init?.method === 'POST') return json(false, { error: 'Not allowed' }, 400)
      return json(true, amendment)
    })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Amend Invoice' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not allowed', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('shows a pending amendment draft notice and hides Amend Invoice', async () => {
    amendment = { draft: { id: 'd5', order_number: 'ORD-9-A' } }
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    expect(await screen.findByText('An amendment draft is pending for this invoice.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View draft (ORD-9-A)' })).toHaveAttribute('href', expect.stringContaining('/admin/invoices/d5/view'))
    expect(screen.queryByRole('button', { name: 'Amend Invoice' })).not.toBeInTheDocument()
  })

  it('hides write actions without invoices write access', async () => {
    render(asMember(<InvoiceDetailClient id="i1" />, ['invoices:read']))
    await screen.findByText('Invoice #INV-100')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/invoices/i1/amendment-draft', { credentials: 'include' }))
    expect(screen.queryByRole('button', { name: 'Amend Invoice' })).not.toBeInTheDocument()
    expect(screen.getByText('replies:false')).toBeInTheDocument()
  })

  it('a voided invoice shows its status and cannot be amended', async () => {
    setup({ status: 'cancelled' })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    expect(await screen.findByText('cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Amend Invoice' })).not.toBeInTheDocument()
  })

  it('a draft invoice offers Edit and Finalize, and finalizing reloads', async () => {
    setup({ status: 'draft' })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    expect(await screen.findByRole('link', { name: /Edit/ })).toHaveAttribute('href', expect.stringContaining('view=edit&edit=o1'))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/invoices/i1/amendment-draft', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Finalize Invoice' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/invoices/drafts/i1/finalize', { method: 'POST', credentials: 'include' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/admin/invoices/i1/detail').length).toBe(2))
  })

  it('toasts the server error when finalizing fails', async () => {
    setup({ status: 'draft' })
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/invoices/i1/detail') return json(true, detail)
      if (init?.method === 'POST') return json(false, { error: 'Missing customer' }, 400)
      return json(true)
    })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize Invoice' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Missing customer', 'error'))
  })

  it('generates a UPI QR for an unpaid QR invoice and shows it in a dialog', async () => {
    setup({ payment_mode: 'upi_qr', total_amount: '1180' })
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/invoices/i1/detail') return json(true, detail)
      if (url === '/api/admin/razorpay/qr') return json(true, { qrImageUrl: 'https://cdn.test/qr.png' })
      return json(true, amendment)
    })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    fireEvent.click(await screen.findByRole('button', { name: /QR/ }))
    expect(await screen.findByAltText('UPI QR Code')).toHaveAttribute('src', 'https://cdn.test/qr.png')
    const [, init] = fetchMock.mock.calls.find(c => c[0] === '/api/admin/razorpay/qr')!
    expect(JSON.parse(init.body)).toEqual({ orderId: 'o1', amountPaise: 118000, description: 'Jeffi Invoice INV-100' })
    expect(screen.getByText('Scan with any UPI app to pay')).toBeInTheDocument()
  })

  it('toasts when QR generation fails', async () => {
    setup({ payment_mode: 'upi_qr' })
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/invoices/i1/detail') return json(true, detail)
      if (url === '/api/admin/razorpay/qr') return json(false, { error: 'Razorpay down' }, 502)
      return json(true, amendment)
    })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    fireEvent.click(await screen.findByRole('button', { name: /QR/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Razorpay down', 'error'))
  })

  it('does not offer the QR action once the invoice is paid', async () => {
    setup({ payment_mode: 'upi_qr', payment_status: 'paid' })
    render(asAdmin(<InvoiceDetailClient id="i1" />))
    await screen.findByText('Invoice #INV-100')
    expect(screen.queryByRole('button', { name: /^QR/ })).not.toBeInTheDocument()
  })
})

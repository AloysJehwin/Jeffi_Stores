import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const replace = vi.fn()
const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push }), usePathname: () => '/admin/cash-sale', useSearchParams: () => sp }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
let filterQuery = ''
vi.mock('@/components/admin/kit', async orig => ({
  ...(await orig<any>()),
  ListFilters: () => <div>list-filters</div>,
  useFilterQuery: () => filterQuery,
  useListSort: () => ({ sort: null, dir: 'asc' }),
  SortTh: ({ col }: any) => <th>{col.label}</th>,
}))
vi.mock('@/components/admin/channels/ui', () => ({
  TabActionsPortal: ({ children }: any) => <div>{children}</div>,
  TabAction: ({ onClick, label }: any) => <button onClick={onClick}>{label}</button>,
}))
vi.mock('@/components/admin/LineItemsSection', async orig => ({
  ...(await orig<any>()),
  default: ({ items, onChange }: any) => (
    <div>
      <button type="button" onClick={() => onChange([{ ...items[0], product_name: 'Drill', unit_price: '1180', quantity: 2, gst_rate: 18, inventory_quantity: null }])}>fill-line</button>
      <button type="button" onClick={() => onChange([{ ...items[0], product_name: 'Saw', unit_price: '500', quantity: 20, gst_rate: 18, inventory_quantity: 5 }])}>fill-overstock</button>
    </div>
  ),
}))
const lock = { readOnly: false, loaded: true, claimable: false, isMine: true, claim: vi.fn(), markLocked: vi.fn() }
vi.mock('@/hooks/useDraftLock', () => ({ useDraftLock: () => lock }))
const flush = vi.fn(async () => {})
vi.mock('@/hooks/useAutosaveDraft', async orig => ({ ...(await orig<any>()), useAutosaveDraft: () => ({ trigger: vi.fn(), flush, status: 'idle' }) }))
vi.mock('@/components/admin/kit/draft-lock', () => ({ DraftLockBanner: () => <div>lock-banner</div>, LockedFieldset: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/lib/client/draft-lock-client', () => ({ assertDraftResponse: vi.fn(async () => {}), lockHeaders: () => ({}) }))
vi.mock('@/components/admin/AutosaveStatusPill', () => ({ default: () => <span>autosave-pill</span> }))
vi.mock('@/components/ui/HoverCard', () => ({ default: ({ trigger }: any) => <div>{trigger}</div> }))
vi.mock('@/components/admin/RowActions', () => ({
  default: ({ actions }: any) => (
    <div>
      {actions.filter((a: any) => !a.hidden).map((a: any) => (a.href ? <a key={a.key} href={a.href}>{a.label}</a> : <button key={a.key} onClick={() => a.onSelect()}>{a.label}</button>))}
    </div>
  ),
}))
vi.mock('@/components/admin/BatchPickerModal', () => ({ default: () => null }))
vi.mock('@/components/admin/SerialEntryModal', () => ({ default: () => null, SerialPicker: () => null }))
vi.mock('@admin/app/(admin)/admin/cash-sale/_components/CashSaleMobileList', () => ({ default: () => null }))

import CashSaleClient from '@admin/app/(admin)/admin/cash-sale/CashSaleClient'

const sale = (over: Record<string, unknown> = {}) => ({
  id: 's1', order_number: 'ORD-1', invoice_number: 'RC-1', invoice_date: '2026-03-01T10:00:00Z', customer_name: 'Walk-in', total_amount: '1180',
  taxable_amount: '1000', cgst_amount: '90', sgst_amount: '90', igst_amount: '0', payment_status: 'paid', status: 'completed', notes: 'Gift wrap', pdf_url: null, ...over,
})
const sales = [sale(), sale({ id: 's2', order_number: 'ORD-2', invoice_number: null, total_amount: '500', taxable_amount: '0', cgst_amount: '0', sgst_amount: '0', payment_status: 'refunded', status: 'cancelled', notes: null })]
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 400) => ({ ok, status, json: async () => body })
const views: string[] = []

const draw = (scopes = ['invoices:write']) => render(asMember(<CashSaleClient onViewChange={v => views.push(v)} />, scopes))
async function openNew() {
  fireEvent.click(await screen.findByRole('button', { name: 'New Cash Sale' }))
  await screen.findByRole('heading', { name: 'New Cash Sale' })
}

describe('CashSaleClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    filterQuery = ''
    views.length = 0
    for (const m of [replace, push, showToast, confirm, flush, lock.claim, lock.markLocked]) m.mockReset()
    flush.mockResolvedValue(undefined)
    confirm.mockResolvedValue(true)
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      const m = init?.method || 'GET'
      if (url.startsWith('/api/admin/cash-sale?')) return json(true, { sales, total: 2 })
      if (url === '/api/admin/invoices/cash-sale' && m === 'POST') return json(true, { invoiceNumber: 'RC-9', saleId: 's9', invoiceUrl: 'https://cdn.test/rc9.pdf' })
      if (url === '/api/admin/invoices/cash-sale/drafts' && m === 'POST') return json(true, { id: 'd1' })
      if (url.endsWith('/detail') && m === 'PATCH') return json(true, {})
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists cash sales with receipt links, amounts, payment and cancelled badges', async () => {
    draw()
    expect(await screen.findByRole('link', { name: 'RC-1' })).toHaveAttribute('href', expect.stringContaining('/admin/cash-sale/s1/view'))
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/cash-sale?page=1')
    expect(screen.getByText('₹1,180.00')).toBeInTheDocument()
    expect(screen.getByText(/Taxable ₹/)).toBeInTheDocument()
    expect(screen.getByText('paid')).toBeInTheDocument()
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Walk-in Customer').length).toBeGreaterThan(0)
    expect(views).toContain('list')
  })

  it('shows the empty state text with and without filters', async () => {
    fetchMock.mockResolvedValue(json(true, { sales: [], total: 0 }))
    const { unmount } = draw()
    expect(await screen.findByText('No cash sales found.')).toBeInTheDocument()
    unmount()
    filterQuery = 'payment=paid'
    draw()
    expect(await screen.findByText('No cash sales match these filters.')).toBeInTheDocument()
  })

  it('opens the detail dialog from a row and cancels the sale from it', async () => {
    draw()
    fireEvent.click((await screen.findByText('ORD-1')).closest('tr')!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Gift wrap')).toBeInTheDocument()
    expect(within(dialog).getByText('₹90.00 + ₹90.00')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Receipt PDF/ })).toHaveAttribute('href', '/api/admin/cash-sale/s1/receipt')
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel Sale/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Cash sale cancelled and stock restored', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[0] === '/api/admin/cash-sale/s1/detail')!
    expect(JSON.parse(patch[1].body)).toEqual({ action: 'cancel' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancels a sale from the row action after confirmation and reloads', async () => {
    draw()
    await screen.findByRole('link', { name: 'RC-1' })
    const before = fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/cash-sale?')).length
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Sale' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Cash sale cancelled and stock restored', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancel Sale', variant: 'danger' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/cash-sale?')).length).toBeGreaterThan(before))
  })

  it('does not cancel when declined and toasts a server failure', async () => {
    confirm.mockResolvedValue(false)
    draw()
    await screen.findByRole('link', { name: 'RC-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Sale' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/detail'))).toBe(false)
    confirm.mockResolvedValue(true)
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/detail') ? json(false, { error: 'Already cancelled' }) : json(true, { sales, total: 2 })))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Sale' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already cancelled', 'error'))
  })

  it('hides New Cash Sale and cancel actions without invoice write access', async () => {
    draw(['invoices:read'])
    await screen.findByRole('link', { name: 'RC-1' })
    expect(screen.queryByRole('button', { name: 'New Cash Sale' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Sale' })).not.toBeInTheDocument()
  })

  it('rejects submitting a blank line with a toast', async () => {
    draw()
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: 'Complete Sale' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('All items need a name and price', 'error'))
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false)
  })

  it('completes a sale with the chosen payment mode, notes and items, then shows the receipt', async () => {
    draw()
    await openNew()
    fireEvent.click(screen.getByText('fill-line'))
    expect(screen.getAllByText('₹2,360.00').length).toBeGreaterThan(0)
    expect(screen.getByText('Items (1)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'UPI' }))
    fireEvent.change(screen.getByPlaceholderText('Any remarks for this sale...'), { target: { value: 'Gift wrap' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete Sale' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Receipt RC-9 created', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/invoices/cash-sale' && c[1]?.method === 'POST')!
    const body = JSON.parse(post[1].body)
    expect(body).toMatchObject({ paymentMode: 'upi', notes: 'Gift wrap', batch_assignments: [], serial_assignments: [] })
    expect(body.items[0]).toMatchObject({ product_name: 'Drill', quantity: 2, unit_price: 1180 })
    expect(await screen.findByRole('heading', { name: 'Receipt' })).toBeInTheDocument()
    expect(screen.getByText('RC-9')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Print \/ Download Receipt/ })).toHaveAttribute('href', 'https://cdn.test/rc9.pdf')
    expect(screen.getByText('Notes: Gift wrap')).toBeInTheDocument()
    expect(screen.getByText('upi')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View All Sales' }))
    expect(await screen.findByRole('link', { name: 'RC-1' })).toBeInTheDocument()
  })

  it('UPI QR shows the payment QR first and creates no sale until paid', async () => {
    const intent = { intentId: 'pi_1', qrImageUrl: 'https://cdn.test/qr.png', amount: 2360, expiresAt: new Date(Date.now() + 600_000).toISOString() }
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      const m = init?.method || 'GET'
      if (url.startsWith('/api/admin/cash-sale?')) return json(true, { sales, total: 2 })
      if (url === '/api/admin/payments/qr-intents' && m === 'POST') return json(true, intent)
      if (url === '/api/admin/payments/qr-intents/pi_1') return json(true, { status: 'pending' })
      return json(true, {})
    })
    draw()
    await openNew()
    fireEvent.click(screen.getByText('fill-line'))
    fireEvent.click(screen.getByRole('radio', { name: 'UPI (QR Scan)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show payment QR' }))
    expect(await screen.findByAltText('UPI QR code')).toHaveAttribute('src', 'https://cdn.test/qr.png')
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/payments/qr-intents')!
    const body = JSON.parse(post[1].body)
    expect(body.kind).toBe('cash_sale')
    expect(body.payload).toMatchObject({ paymentMode: 'upi_qr', batch_assignments: [], serial_assignments: [] })
    expect(body.payload.items[0]).toMatchObject({ product_name: 'Drill', quantity: 2, unit_price: 1180 })
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/invoices/cash-sale')).toBe(false)
  })

  it('blocks a sale that exceeds available stock', async () => {
    draw()
    await openNew()
    fireEvent.click(screen.getByText('fill-overstock'))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Sale' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Insufficient stock for "Saw" — available: 5, required: 20', 'error'))
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false)
  })

  it('toasts the server error when creating the sale fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      init?.method === 'POST' ? json(false, { error: 'Stock changed' }) : json(true, { sales, total: 2 }))
    draw()
    await openNew()
    fireEvent.click(screen.getByText('fill-line'))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Sale' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Stock changed', 'error'))
    expect(screen.queryByRole('heading', { name: 'Receipt' })).not.toBeInTheDocument()
  })

  it('Back from a new sale returns to the list', async () => {
    draw()
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: 'Back to sales list' }))
    expect(await screen.findByRole('link', { name: 'RC-1' })).toBeInTheDocument()
    expect(views.at(-1)).toBe('list')
  })

  it('refuses to hold an empty bill, and holds a filled bill then opens held bills', async () => {
    draw()
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: 'Hold Bill' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Add an item before holding the bill', 'error'))
    fireEvent.click(screen.getByText('fill-line'))
    fireEvent.change(screen.getByLabelText('Bill name'), { target: { value: 'Table 4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hold Bill' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Bill held — resume it from Held bills', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/invoices/cash-sale/drafts' && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({ label: 'Table 4', payment_mode: 'cash' })
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/admin/cash-sale?tab=drafts'), { scroll: false })
  })

  it('resumes a held bill from ?draft= and discards it after confirmation', async () => {
    sp = new URLSearchParams('draft=d7')
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/invoices/cash-sale/drafts/d7' && !init?.method) return json(true, { draft: { label: 'Corner shop', payment_mode: 'upi', notes: 'N', items: [{ id: 'l1', product_name: 'Drill', unit_price: '100', quantity: 1, product_id: null }], assignments: {} } })
      if (url === '/api/admin/invoices/cash-sale/drafts/d7' && init?.method === 'DELETE') return json(true, {})
      return json(true, { sales, total: 2 })
    })
    draw()
    expect(await screen.findByRole('heading', { name: 'Held bill · Corner shop' })).toBeInTheDocument()
    expect(screen.getByText('lock-banner')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'UPI' })).toBeChecked()
    expect(screen.getByPlaceholderText('Any remarks for this sale...')).toHaveValue('N')
    fireEvent.click(screen.getByRole('button', { name: 'Discard bill' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Held bill discarded', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard held bill', variant: 'danger' }))
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/admin/cash-sale?tab=drafts'), { scroll: false })
  })

  it('goes back to the drafts tab when a held bill cannot be opened', async () => {
    sp = new URLSearchParams('draft=gone')
    fetchMock.mockImplementation(async (url: string) => (url.includes('/drafts/gone') ? json(false, { error: 'Bill not found' }) : json(true, { sales, total: 2 })))
    draw()
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Bill not found', 'error'))
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/admin/cash-sale?tab=drafts'))
  })

  it('works for an administrator role too', async () => {
    render(asAdmin(<CashSaleClient />))
    expect(await screen.findByRole('button', { name: 'New Cash Sale' })).toBeInTheDocument()
  })
})

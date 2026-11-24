import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/packing-slips',
  useSearchParams: () => new URLSearchParams(),
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: () => <div>filters</div> }))
vi.mock('@admin/app/(admin)/admin/packing-slips/_components/PackingSlipsMobileList', () => ({ default: () => <div>mobile-list</div> }))

const downloadDocuments = vi.fn()
vi.mock('@admin/app/(admin)/admin/packing-slips/_components/order-documents', () => ({
  DOC_ORDER: ['packing_slip', 'invoice'],
  DOC_META: {
    packing_slip: { label: 'Packing slip', unavailable: 'No slip', icon: 'M0' },
    invoice: { label: 'Invoice', unavailable: 'No invoice yet', icon: 'M1' },
  },
  DOWNLOAD_ICON: 'M2',
  Icon: () => <i />,
  DocumentSetPicker: () => <div>doc-picker</div>,
  docAvailable: (o: any, d: string) => (d === 'packing_slip' ? true : !!o.has_invoice),
  downloadDocuments: (...a: any[]) => downloadDocuments(...a),
  useDocumentSet: () => [{ docs: ['packing_slip'] }, vi.fn()],
}))

import PackingSlipsClient from '@admin/app/(admin)/admin/packing-slips/PackingSlipsClient'

const orders = [
  { id: 'o1', order_number: 'ORD-1', customer_name: 'Asha Rao', created_at: '2026-03-01T10:00:00Z', status: 'shipped', total_amount: 1999.5, has_invoice: true },
  { id: 'o2', order_number: 'ORD-2', customer_name: '', created_at: '2026-03-02T10:00:00Z', status: 'pending', total_amount: 50, has_invoice: false },
]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('PackingSlipsClient', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    downloadDocuments.mockReset()
    downloadDocuments.mockResolvedValue(0)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(json(true, { orders, total: 2 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists orders with customer, date, status and total, plus the default window note', async () => {
    render(asAdmin(<PackingSlipsClient header={<h1>Packing</h1>} />, ['orders:read']))
    expect(screen.getByText('Packing')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '#ORD-1' })).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1/view'))
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/packing-slips/list?')
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Shipped')).toBeInTheDocument()
    expect(screen.getByText('₹1,999.50')).toBeInTheDocument()
    expect(screen.getByText(/Showing orders from the last \d+ days/)).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    fetchMock.mockResolvedValue(json(true, { orders: [], total: 0 }))
    render(asAdmin(<PackingSlipsClient />))
    expect(await screen.findByText('No orders found for the selected date range.')).toBeInTheDocument()
  })

  it('shows the load error', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Query failed' }))
    render(asAdmin(<PackingSlipsClient />))
    expect((await screen.findAllByText('Query failed')).length).toBeGreaterThan(0)
  })

  it('downloads a single document for a row, disabling unavailable ones', async () => {
    render(asAdmin(<PackingSlipsClient />, ['orders:read']))
    await screen.findByRole('link', { name: '#ORD-1' })
    expect(screen.getByRole('button', { name: 'Invoice for #ORD-2' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Invoice for #ORD-1' }))
    await waitFor(() => expect(downloadDocuments).toHaveBeenCalledWith({ orderId: 'o1' }, { docs: ['invoice'] }))
  })

  it('downloads the chosen set for a row and warns when some were skipped', async () => {
    downloadDocuments.mockResolvedValue('1 had no invoice')
    render(asAdmin(<PackingSlipsClient />))
    await screen.findByRole('link', { name: '#ORD-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Download chosen documents for #ORD-1' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Downloaded #ORD-1, but 1 had no invoice.', 'warning'))
    expect(downloadDocuments).toHaveBeenCalledWith({ orderId: 'o1' }, { docs: ['packing_slip'] })
  })

  it('toasts a download failure', async () => {
    downloadDocuments.mockRejectedValue(new Error('PDF service down'))
    render(asAdmin(<PackingSlipsClient />))
    await screen.findByRole('link', { name: '#ORD-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Download chosen documents for #ORD-1' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('PDF service down', 'error'))
  })

  it('selects all loaded orders and downloads them as one PDF', async () => {
    render(asAdmin(<PackingSlipsClient />, ['orders:read']))
    await screen.findByRole('link', { name: '#ORD-1' })
    fireEvent.click(screen.getByLabelText('Select all loaded orders'))
    fireEvent.click(screen.getByRole('button', { name: 'Download Selected (2)' }))
    await waitFor(() => expect(downloadDocuments).toHaveBeenCalledWith({ orderIds: ['o1', 'o2'] }, { docs: ['packing_slip'] }))
  })

  it('hides bulk download without packing_slips write and only offers the packing slip without orders read', async () => {
    render(asMember(<PackingSlipsClient />, []))
    await screen.findByRole('link', { name: '#ORD-1' })
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.queryByRole('button', { name: /Download Selected/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invoice for #ORD-1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Packing slip for #ORD-1' })).toBeInTheDocument()
  })
})

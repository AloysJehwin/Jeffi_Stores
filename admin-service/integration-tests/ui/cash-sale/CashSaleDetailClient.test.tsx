import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => '/admin/cash-sale/s1' }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: ({ kind, id }: any) => <div>changelog:{kind}:{id}</div> }))

import CashSaleDetailClient from '@admin/app/(admin)/admin/cash-sale/[id]/CashSaleDetailClient'

const sale = {
  id: 's1',
  invoice_number: 'INV-100',
  sale_number: 'CS-7',
  payment_status: 'paid',
  payment_mode: 'upi_qr',
  customer_name: null,
  taxable_amount: '1000',
  cgst_amount: '90',
  sgst_amount: '90',
  igst_amount: '0',
  total_amount: '1180',
  invoice_date: '2026-02-01',
  updated_at: '2026-02-01',
  notes: 'Paid at counter',
}
const items = [
  { product_name: 'Hammer', gst_rate: '18', quantity: '2', unit_price: '500', taxable_amount: '1000', cgst_amount: '90', sgst_amount: '90', igst_amount: '0', total_price: '1180' },
]

const fetchMock = vi.fn()

describe('CashSaleDetailClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the sale header, line items and CGST/SGST split', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ sale, items }) })
    render(<CashSaleDetailClient id="s1" />)
    expect((await screen.findAllByText('INV-100')).length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/cash-sale/s1/detail')
    expect(screen.getByText('Cash Sale')).toBeInTheDocument()
    expect(screen.getByText('paid')).toBeInTheDocument()
    expect(screen.getByText('Hammer')).toBeInTheDocument()
    expect(screen.getByText('18%')).toBeInTheDocument()
    expect(screen.getByText('CGST')).toBeInTheDocument()
    expect(screen.getByText('SGST')).toBeInTheDocument()
    expect(screen.queryByText('IGST')).not.toBeInTheDocument()
    expect(screen.getByText('UPI (QR)')).toBeInTheDocument()
    expect(screen.getByText('Walk-in Customer')).toBeInTheDocument()
    expect(screen.getByText('Paid at counter')).toBeInTheDocument()
    expect(screen.getByText('changelog:cash_sale:s1')).toBeInTheDocument()
  })

  it('links the receipt PDF', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ sale, items }) })
    render(<CashSaleDetailClient id="s1" />)
    const link = await screen.findByRole('link', { name: /Receipt PDF/ })
    expect(link).toHaveAttribute('href', '/api/admin/cash-sale/s1/receipt')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows IGST instead of CGST/SGST for an inter-state sale and flags unpaid', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ sale: { ...sale, igst_amount: '180', cgst_amount: '0', sgst_amount: '0', payment_status: 'unpaid', notes: '' }, items }),
    })
    render(<CashSaleDetailClient id="s1" />)
    expect(await screen.findByText('IGST')).toBeInTheDocument()
    expect(screen.queryByText('CGST')).not.toBeInTheDocument()
    expect(screen.getByText('unpaid')).toBeInTheDocument()
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
  })

  it('shows not found with a link back to invoices', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({}) })
    render(<CashSaleDetailClient id="x" />)
    expect(await screen.findByText('Sale not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Invoices' })).toBeInTheDocument()
  })

  it('shows not found when the request rejects', async () => {
    fetchMock.mockRejectedValue(new Error('net'))
    render(<CashSaleDetailClient id="x" />)
    await waitFor(() => expect(screen.getByText('Sale not found.')).toBeInTheDocument())
  })
})

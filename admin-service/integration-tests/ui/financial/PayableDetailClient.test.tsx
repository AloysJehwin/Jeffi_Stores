import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => '/admin/financial/payables/e1' }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: ({ kind, id }: any) => <div>changelog:{kind}:{id}</div> }))

const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))

import PayableDetailClient from '@admin/app/(admin)/admin/financial/payables/[id]/PayableDetailClient'

const expense = {
  expense_number: 'EXP-0042',
  supplier_name: 'Acme Supplies',
  supplier_gstin: '29ABCDE1234F1Z5',
  description: 'Packaging order',
  notes: 'Net 30',
  status: 'partial',
  amount: '1000',
  tax_amount: '180',
  total_amount: '1180',
  expense_date: '2026-01-05',
  due_date: '2020-01-01',
  updated_at: '2026-01-06',
  po_number: 'PO-9',
  po_status: 'received',
}
const payments = [
  { id: 'a', payment_date: '2026-01-10', payment_method: 'upi', amount: '400', reference: 'UTR123', payout_id: null, payout_status: 'processed' },
  { id: 'b', payment_date: '2026-01-12', payment_method: 'cheque', amount: '100', reference: null, payout_id: 'pout_1', payout_status: 'failed' },
]

const fetchMock = vi.fn()

describe('PayableDetailClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads the expense and shows KPIs, payment history and the linked PO', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ expense, payments }) })
    render(<PayableDetailClient id="e1" />)
    expect(await screen.findByText('EXP-0042')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/financial/payables/e1')
    expect(screen.getAllByText('₹1,180').length).toBeGreaterThan(0)
    // paid 500, remaining 680
    expect(screen.getAllByText('₹500').length).toBeGreaterThan(0)
    expect(screen.getAllByText('₹680').length).toBeGreaterThan(0)
    expect(screen.getByText('Payment History')).toBeInTheDocument()
    expect(screen.getAllByText('UPI').length).toBeGreaterThan(0)
    expect(screen.getAllByText('UTR123').length).toBeGreaterThan(0)
    expect(screen.getByText('processed')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument()
    expect(screen.getByText('Linked Purchase Order')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View in Inventory' })).toHaveAttribute('href', expect.stringContaining('po=PO-9'))
    expect(screen.getByText('changelog:payable:e1')).toBeInTheDocument()
  })

  it('shows the empty payment history for an unpaid bill with no PO', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ expense: { ...expense, po_number: null, status: 'unpaid' }, payments: [] }) })
    render(<PayableDetailClient id="e1" />)
    expect(await screen.findByText('No payments recorded yet')).toBeInTheDocument()
    expect(screen.queryByText('Linked Purchase Order')).not.toBeInTheDocument()
  })

  it('shows not found with a way back when the expense is missing', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({}) })
    render(<PayableDetailClient id="nope" />)
    expect(await screen.findByText('Expense not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Payables' })).toHaveAttribute('href', expect.stringContaining('tab=payables'))
  })

  it('falls back to not found when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('net'))
    render(<PayableDetailClient id="e1" />)
    await waitFor(() => expect(screen.getByText('Expense not found.')).toBeInTheDocument())
  })
})

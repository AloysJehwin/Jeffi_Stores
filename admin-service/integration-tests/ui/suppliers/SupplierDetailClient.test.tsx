import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const replace = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/admin/suppliers/s1/view',
  useSearchParams: () => sp,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: ({ kind }: any) => <div>changelog:{kind}</div> }))

const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))

import SupplierDetailClient from '@admin/app/(admin)/admin/suppliers/[id]/SupplierDetailClient'

const supplier = {
  name: 'Acme Supplies',
  is_active: false,
  gstin: '29ABCDE1234F1Z5',
  contact_name: 'Ravi',
  phone: '9876543210',
  email: 'ravi@acme.test',
  address: '12 Industrial Area',
  payment_terms: 30,
  bank_name: 'HDFC',
  account_number: '0001',
  ifsc: 'HDFC0001',
  upi_id: 'acme@upi',
  po_count: 4,
  po_total: '40000',
  expense_count: 2,
  expense_total: '5000',
  notes: 'Pays late',
}
const data = {
  supplier,
  pos: [{ id: 'po1', po_number: 'PO-1', order_date: '2026-01-01', expected_date: '2026-01-10', status: 'received', total_amount: '12000' }],
  expenses: [{ id: 'e1', expense_number: 'EXP-1', po_number: 'PO-1', expense_date: '2026-01-02', due_date: '2020-01-01', status: 'unpaid', total_amount: '3000' }],
  linkedProducts: [{ product_id: 'p1', product_name: 'Drill', variant_name: '18V', unit_cost: '900', is_preferred: true, moq: 5, lead_time_days: 7 }],
  purchasedProducts: [{ product_id: 'p1', product_name: 'Drill', total_qty: 20, last_unit_cost: '880', last_order_date: '2026-01-01', po_count: 2 }],
}
const fetchMock = vi.fn()

describe('SupplierDetailClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ json: async () => data })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows contact, GST & payment, summary and the PO tab', async () => {
    render(asAdmin(<SupplierDetailClient id="s1" />, ['financial:read']))
    expect(await screen.findByText('Acme Supplies')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/suppliers/s1')
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+91 9876543210' })).toHaveAttribute('href', 'tel:+919876543210')
    expect(screen.getByRole('link', { name: 'ravi@acme.test' })).toHaveAttribute('href', 'mailto:ravi@acme.test')
    expect(screen.getByText('30 days')).toBeInTheDocument()
    expect(screen.getByText('₹40,000')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'PO-1' })).toHaveAttribute('href', expect.stringContaining('po=PO-1'))
    expect(screen.getByText('Received')).toBeInTheDocument()
    expect(screen.getByText('Pays late')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Purchase Orders (1)' })).toBeInTheDocument()
  })

  it('switches tabs and syncs the URL', async () => {
    render(asAdmin(<SupplierDetailClient id="s1" />, ['financial:read']))
    await screen.findByText('Acme Supplies')
    fireEvent.click(screen.getByRole('tab', { name: 'Bills / Expenses (1)' }))
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/admin/suppliers/s1/view?tab=expenses'), { scroll: false })
    expect(screen.getByRole('link', { name: 'EXP-1' })).toHaveAttribute('href', expect.stringContaining('/admin/financial/payables/e1/view'))
    expect(screen.getByText('Unpaid')).toBeInTheDocument()
  })

  it('does not link bills without the financial scope', async () => {
    sp = new URLSearchParams('tab=expenses')
    render(asMember(<SupplierDetailClient id="s1" />, ['inventory:read']))
    expect(await screen.findByText('EXP-1')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'EXP-1' })).not.toBeInTheDocument()
  })

  it('shows linked and purchased products', async () => {
    sp = new URLSearchParams('tab=products')
    render(asAdmin(<SupplierDetailClient id="s1" />))
    expect(await screen.findByText('Linked (buy-price list)')).toBeInTheDocument()
    expect(screen.getByText('Purchased (from POs)')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Drill' })).toHaveLength(2)
    expect(screen.getByText('18V')).toBeInTheDocument()
    expect(screen.getByText('★')).toBeInTheDocument()
  })

  it('shows the change log tab', async () => {
    sp = new URLSearchParams('tab=changes')
    render(asAdmin(<SupplierDetailClient id="s1" />))
    expect(await screen.findByText('changelog:supplier')).toBeInTheDocument()
  })

  it('offers Edit with write access and the draft state labels', async () => {
    const action = vi.fn()
    const { unmount } = render(asAdmin(<SupplierDetailClient id="s1" draftCount={2} startDraftAction={action} />, ['inventory:write']))
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByText('2 drafts')).toBeInTheDocument()
    unmount()
    render(asAdmin(<SupplierDetailClient id="s1" myDraft draftCount={1} startDraftAction={action} />, ['inventory:write']))
    expect(await screen.findByRole('button', { name: 'Edit my draft' })).toBeInTheDocument()
    expect(screen.getByText('Draft pending')).toBeInTheDocument()
  })

  it('has no Edit without inventory write', async () => {
    render(asMember(<SupplierDetailClient id="s1" startDraftAction={vi.fn()} />, ['inventory:read']))
    await screen.findByText('Acme Supplies')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('shows not found with the API error and a way back', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ error: 'no such supplier' }) })
    render(asAdmin(<SupplierDetailClient id="x" />))
    expect(await screen.findByText('Supplier not found.')).toBeInTheDocument()
    expect(screen.getByText('no such supplier')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Suppliers' })).toBeInTheDocument()
  })

  it('falls back to not found when the request rejects', async () => {
    fetchMock.mockRejectedValue(new Error('net'))
    render(asAdmin(<SupplierDetailClient id="x" />))
    await waitFor(() => expect(screen.getByText('Supplier not found.')).toBeInTheDocument())
  })
})

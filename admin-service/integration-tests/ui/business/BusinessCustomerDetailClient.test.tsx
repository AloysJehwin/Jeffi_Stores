import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => '/admin/business/customers/c1' }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: () => <div>changelog</div> }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, label }: any) => (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">pick</option>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import BusinessCustomerDetailClient from '@admin/app/(admin)/admin/business/customers/[id]/BusinessCustomerDetailClient'

const customer = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  email: 'buyer@acme.test',
  first_name: 'Ravi',
  last_name: 'Kumar',
  phone: '9876543210',
  created_at: '2026-01-05T00:00:00Z',
  company_name: 'Acme Traders',
  gst_number: '29ABCDE1234F1Z5',
  business_address: '1 Market St',
  industry: 'Retail',
  approval_status: 'pending',
  approved_at: null,
  rejection_note: null,
  ...over,
})
const discounts = [{ id: 'd1', category_id: 'cat1', category_name: 'Tools', discount_pct: 5 }]
const categories = [{ id: 'cat1', name: 'Tools' }, { id: 'cat2', name: 'Paint' }]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

function setup(c = customer()) {
  fetchMock.mockImplementation(async (url: string, init?: any) => {
    const u = String(url)
    if (init?.method === 'POST') return json(true)
    if (u === '/api/categories') return json(true, { categories })
    return json(true, { customer: c, discounts })
  })
}

describe('BusinessCustomerDetailClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    setup()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the business profile, KPIs and discounts', async () => {
    render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    expect((await screen.findAllByText('Acme Traders')).length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/business/customers/c1', { credentials: 'include' })
    expect(screen.getAllByText('29ABCDE1234F1Z5').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Retail').length).toBeGreaterThan(0)
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('This account is awaiting your review.')).toBeInTheDocument()
    expect(screen.getByText('changelog')).toBeInTheDocument()
  })

  it('approves a pending account', async () => {
    render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Account' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Account approved', 'success'))
    const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/approve'))!
    expect(JSON.parse(call[1].body)).toEqual({ action: 'approve' })
    expect(screen.getByRole('button', { name: 'Revoke & Reject' })).toBeInTheDocument()
  })

  it('toasts when approval fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => (init?.method === 'POST' ? json(false) : String(url) === '/api/categories' ? json(true, { categories }) : json(true, { customer: customer(), discounts })))
    render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Account' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to approve', 'error'))
  })

  it('rejects with a note', async () => {
    render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Reject Account' }))
    fireEvent.change(screen.getByPlaceholderText('Rejection reason (optional)'), { target: { value: 'GST mismatch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Account rejected', 'success'))
    const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/approve'))!
    expect(JSON.parse(call[1].body)).toEqual({ action: 'reject', rejectionNote: 'GST mismatch' })
    expect(screen.getByText('GST mismatch')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve Instead' })).toBeInTheDocument()
  })

  it('cancel closes the reject form', async () => {
    render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Reject Account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Reject Account' })).toBeInTheDocument()
  })

  it('adds a category discount and removes one', async () => {
    render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    await screen.findByText('Tools')
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat2' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '12.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.getByText('Paint')).toBeInTheDocument())
    const add = fetchMock.mock.calls.filter(c => c[0] === '/api/admin/business/discounts')[0]
    expect(JSON.parse(add[1].body)).toEqual({ userId: 'c1', categoryId: 'cat2', discountPct: 12.5 })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await waitFor(() => expect(screen.queryByText('Tools', { selector: 'span' })).not.toBeInTheDocument())
  })

  it('saves an edited discount on blur only when the value changed', async () => {
    render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    await screen.findByText('Tools')
    const input = screen.getAllByRole('spinbutton')[0]
    fireEvent.blur(input, { target: { value: '5' } })
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/business/discounts')).toBe(false)
    fireEvent.blur(input, { target: { value: '8' } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Discount saved', 'success'))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[0] === '/api/admin/business/discounts')![1].body).discountPct).toBe(8)
  })

  it('shows the rejected state with the stored note, and approved with the date', async () => {
    setup(customer({ approval_status: 'rejected', rejection_note: 'Incomplete docs' }))
    const { unmount } = render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    expect(await screen.findByText('Incomplete docs')).toBeInTheDocument()
    unmount()
    setup(customer({ approval_status: 'approved', approved_at: '2026-02-01T00:00:00Z' }))
    render(asAdmin(<BusinessCustomerDetailClient id="c1" />))
    expect(await screen.findByText(/^Approved on/)).toBeInTheDocument()
  })

  it('is read-only without business_customers write', async () => {
    render(asMember(<BusinessCustomerDetailClient id="c1" />, ['business_customers:read']))
    await screen.findByText('Tools')
    expect(screen.queryByRole('button', { name: 'Approve Account' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('spinbutton')[0]).toBeDisabled()
  })

  it('shows not found when the customer is missing', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url) === '/api/categories' ? json(true, { categories }) : json(true, {})))
    render(asAdmin(<BusinessCustomerDetailClient id="x" />))
    expect(await screen.findByText('Customer not found.')).toBeInTheDocument()
  })
})

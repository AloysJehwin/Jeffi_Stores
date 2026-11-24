import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/financial/upi',
  useSearchParams: () => new URLSearchParams(),
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label="status" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import UpiConfirmationsClient from '@admin/app/(admin)/admin/financial/upi/UpiConfirmationsClient'

const intent = {
  id: 'i1',
  status: 'awaiting_confirmation',
  purpose: 'order_payment',
  amount_paise: 123450,
  utr: '412345678901',
  order_id: 'o1',
  order_number: 'ORD-55',
  customer_name: 'Asha Rao',
  customer_email: 'asha@x.test',
  created_at: '2026-03-01T10:00:00Z',
  suggestions: [{ id: 's1', utr: '412345678901', amount_paise: 123450, sender_vpa: 'asha@upi', bank_domain: 'hdfcbank.net' }],
}
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('UpiConfirmationsClient', () => {
  beforeEach(() => {
    confirm.mockResolvedValue(true)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/decide') ? json(true) : json(true, { items: [intent], total: 1 })))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists awaiting payments with order link, customer, amount, UTR and the unverified bank email', async () => {
    render(asAdmin(<UpiConfirmationsClient />))
    const link = await screen.findByRole('link', { name: '#ORD-55' })
    expect(link).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1'))
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('₹1,234.50')).toBeInTheDocument()
    expect(screen.getAllByText('412345678901').length).toBeGreaterThan(0)
    expect(screen.getByText(/Sender not verified/)).toBeInTheDocument()
    expect(screen.getByText('Awaiting confirmation', { selector: 'span' })).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toContain('status=awaiting_confirmation')
  })

  it('shows the empty state per filter', async () => {
    fetchMock.mockResolvedValue(json(true, { items: [], total: 0 }))
    render(asAdmin(<UpiConfirmationsClient />))
    expect(await screen.findByText('No payments are waiting for confirmation.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('status'), { target: { value: 'rejected' } })
    expect(await screen.findByText('No matching payments.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('status=rejected'))).toBe(true)
  })

  it('shows the load error', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Upstream failed' }))
    render(asAdmin(<UpiConfirmationsClient />))
    expect(await screen.findByText('Upstream failed')).toBeInTheDocument()
  })

  it('approving confirms, posts the decision, toasts and reloads', async () => {
    render(asAdmin(<UpiConfirmationsClient />))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Payment of ₹1,234.50 approved.', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Approve this payment?' }))
    const call = fetchMock.mock.calls.find(c => String(c[0]).includes('/decide'))!
    expect(call[0]).toBe('/api/admin/payments/upi/i1/decide')
    expect(JSON.parse(call[1].body)).toEqual({ action: 'approve' })
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => !String(c[0]).includes('/decide')).length).toBeGreaterThan(1))
  })

  it('rejecting posts reject and toasts', async () => {
    render(asAdmin(<UpiConfirmationsClient />))
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Payment of ₹1,234.50 rejected.', 'success'))
    expect(JSON.parse(fetchMock.mock.calls.find(c => String(c[0]).includes('/decide'))![1].body)).toEqual({ action: 'reject' })
  })

  it('does nothing when the confirmation is declined', async () => {
    confirm.mockResolvedValue(false)
    render(asAdmin(<UpiConfirmationsClient />))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/decide'))).toBe(false)
  })

  it('toasts the API error when the decision fails', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/decide') ? json(false, { error: 'Already decided' }) : json(true, { items: [intent], total: 1 })))
    render(asAdmin(<UpiConfirmationsClient />))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already decided', 'error'))
  })

  it('disables approve and reject without orders write', async () => {
    render(asMember(<UpiConfirmationsClient />, ['orders:read']))
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
  })

  it('hides the bank-email column when no row has a suggestion', async () => {
    fetchMock.mockResolvedValue(json(true, { items: [{ ...intent, suggestions: [] }], total: 1 }))
    render(asAdmin(<UpiConfirmationsClient />))
    await screen.findByRole('link', { name: '#ORD-55' })
    expect(screen.queryByText('Unverified bank email')).not.toBeInTheDocument()
  })
})

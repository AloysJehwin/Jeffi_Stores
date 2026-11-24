import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/wallet',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: () => <div>filters</div> }))
const upiStart = vi.fn()
vi.mock('@/components/payments', () => ({
  PaymentSections: ({ value, onChange }: any) => (
    <div>
      <span>method:{value}</span>
      <button onClick={() => onChange('razorpay')}>pick-razorpay</button>
    </div>
  ),
  UpiManualDialog: () => null,
  razorpayDisplayConfig: () => ({ display: {} }),
  useUpiPayment: () => ({ start: upiStart, busy: false, manual: null, error: null, confirmUtr: vi.fn(), dismissManual: vi.fn() }),
}))

import WalletClient from '@admin/app/(admin)/admin/wallet/WalletClient'

const ledger = [
  { id: 'l1', entry_type: 'recharge', category: 'recharge', amount: '2000', order_ref: null, awb: null, note: 'Top-up', occurred_at: '2026-03-01T10:00:00Z' },
  { id: 'l2', entry_type: 'debit', category: 'shipping_forward', amount: '-85.5', order_ref: 'ORD-9', awb: 'AWB1', note: null, occurred_at: '2026-03-02T10:00:00Z' },
]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()
const wallet = { balance: 1500, minBalance: 500, currency: 'INR' }

describe('WalletClient', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/topup/ledger')) return json(true, { rows: ledger, total: 2, credit: 2000, debit: 85.5 })
      if (String(url).endsWith('/wallet/topup')) return json(true, { balance: 3500, minBalance: 500, currency: 'INR' })
      return json(true)
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    delete (window as any).Razorpay
  })

  it('shows balance, ledger totals and the ledger rows', async () => {
    render(asAdmin(<WalletClient initial={wallet} />))
    expect(screen.getByText('Shipping Wallet')).toBeInTheDocument()
    expect(screen.getByText('₹1,500.00')).toBeInTheDocument()
    expect(screen.getByText('minimum ₹500.00')).toBeInTheDocument()
    expect(await screen.findByText('Shipping — forward')).toBeInTheDocument()
    expect(screen.getByText('+₹2,000.00')).toBeInTheDocument()
    expect(screen.getByText('−₹85.50')).toBeInTheDocument()
    expect(screen.getByText('ORD-9')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('₹85.50')).toBeInTheDocument())
  })

  it('warns when the balance is below the minimum', () => {
    render(asAdmin(<WalletClient initial={{ ...wallet, balance: 100 }} />))
    expect(screen.getByText('Balance is below the minimum. Shipments may be blocked.')).toBeInTheDocument()
    expect(screen.getByText('below minimum ₹500.00')).toBeInTheDocument()
  })

  it('shows the AI spend table with unpaid and platform-paid rows', () => {
    render(asAdmin(<WalletClient initial={wallet} aiSpend={[{ feature: 'product_copy', calls: 12, spent: 30, unpaid: 2 }, { feature: 'alt_text', calls: 3, spent: 0, unpaid: 0, paidBy: 'Jeffi' }]} aiSpendDays={14} />))
    expect(screen.getByText('AI spend, last 14 days')).toBeInTheDocument()
    expect(screen.getByText('2 unpaid calls')).toBeInTheDocument()
    expect(screen.getByText('Free (paid by Jeffi)')).toBeInTheDocument()
  })

  it('previews the GST breakdown while typing an amount', () => {
    render(asAdmin(<WalletClient initial={wallet} />))
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '1000' } })
    expect(screen.getByText(/₹1,000 credit \+ ₹180 GST \(18%\) = pay ₹1,180/)).toBeInTheDocument()
  })

  it('rejects a zero amount with a toast', () => {
    render(asAdmin(<WalletClient initial={wallet} />))
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
    expect(showToast).toHaveBeenCalledWith('Enter an amount greater than zero.', 'error')
  })

  it('hides the top-up card without delhivery write', () => {
    render(asMember(<WalletClient initial={wallet} />, ['delhivery:read']))
    expect(screen.queryByRole('button', { name: 'Top up' })).not.toBeInTheDocument()
  })

  it('tops up through Razorpay, verifies the payment and refreshes the wallet', async () => {
    let opts: any
    ;(window as any).Razorpay = class { constructor(o: any) { opts = o } open() {} }
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      const u = String(url)
      if (u.includes('/topup/ledger')) return json(true, { rows: ledger, total: 2, credit: 0, debit: 0 })
      if (u.includes('create-order')) return json(true, { key_id: 'k', amount: 100000, currency: 'INR', razorpayOrderId: 'order_1' })
      if (u.includes('/topup/verify')) return json(true)
      return json(true, { balance: 3500, minBalance: 500, currency: 'INR' })
    })
    render(asAdmin(<WalletClient initial={wallet} />))
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
    await waitFor(() => expect(opts).toBeTruthy())
    expect(opts.order_id).toBe('order_1')
    const create = fetchMock.mock.calls.find(c => String(c[0]).includes('create-order'))!
    expect(JSON.parse(create[1].body)).toEqual({ amountInr: 1000 })
    await opts.handler({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Added ₹1,000 to the wallet'), 'success'))
    await waitFor(() => expect(screen.getByText('₹3,500.00')).toBeInTheDocument())
  })

  it('reports a verify failure with the payment id', async () => {
    let opts: any
    ;(window as any).Razorpay = class { constructor(o: any) { opts = o } open() {} }
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes('/topup/ledger')) return json(true, { rows: [], total: 0 })
      if (u.includes('create-order')) return json(true, { key_id: 'k', amount: 1, currency: 'INR', razorpayOrderId: 'o' })
      return json(false)
    })
    render(asAdmin(<WalletClient initial={wallet} />))
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
    await waitFor(() => expect(opts).toBeTruthy())
    await opts.handler({ razorpay_order_id: 'o', razorpay_payment_id: 'pay_x', razorpay_signature: 's' })
    expect(showToast).toHaveBeenCalledWith('Paid, but crediting failed. Payment ID: pay_x', 'error')
  })

  it('surfaces a create-order error', async () => {
    ;(window as any).Razorpay = class { open() {} }
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('create-order') ? json(false, { error: 'Gateway down' }) : json(true, { rows: [], total: 0 })
    )
    render(asAdmin(<WalletClient initial={wallet} />))
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Gateway down', 'error'))
  })

  it('with UPI enabled the default method is UPI and starts a UPI payment', async () => {
    upiStart.mockResolvedValue(true)
    render(asAdmin(<WalletClient initial={wallet} upiEnabled />))
    expect(screen.getByText('method:upi')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
    await waitFor(() => expect(upiStart).toHaveBeenCalledWith({ purpose: 'wallet_topup', amountInr: 500 }))
  })

  it('toasts when the UPI payment cannot start', async () => {
    upiStart.mockResolvedValue(false)
    render(asAdmin(<WalletClient initial={wallet} upiEnabled />))
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Could not start the UPI payment'), 'error'))
  })
})

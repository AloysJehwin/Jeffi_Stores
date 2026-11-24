import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const upiStart = vi.fn<(...a: any[]) => any>()
vi.mock('@/components/payments', () => ({
  PaymentSections: ({ value, onChange }: any) => (
    <div>
      <button type="button" onClick={() => onChange('upi')}>
        UPI{value === 'upi' ? ' (selected)' : ''}
      </button>
      <button type="button" onClick={() => onChange('razorpay')}>
        Card{value === 'razorpay' ? ' (selected)' : ''}
      </button>
    </div>
  ),
  UpiManualDialog: () => null,
  razorpayDisplayConfig: () => ({}),
  useUpiPayment: () => ({ start: upiStart, busy: false, error: null, manual: null, confirmUtr: vi.fn<(...a: any[]) => any>(), dismissManual: vi.fn<(...a: any[]) => any>() }),
}))

import WalletClient from '@controller/app/(ecom)/ecom/dashboard/wallet/WalletClient'

const today = new Date().toISOString()
const ledger = [
  { entry_type: 'debit', category: 'ai', amount: -12.5, note: null, occurred_at: today },
  { entry_type: 'recharge', category: null, amount: 1000, note: null, occurred_at: '2026-11-01T10:00:00Z' },
]
const view = (props: Partial<React.ComponentProps<typeof WalletClient>> = {}) =>
  render(<WalletClient initial={{ balance: 1250.5, ledger }} keyId="rzp_test_x" tenantName="Acme" {...props} />)

afterEach(() => {
  delete (window as any).Razorpay
})

describe('WalletClient', () => {
  it('shows the balance, spend today and last top-up', () => {
    view()
    expect(screen.getByText('₹1,250.50')).toBeInTheDocument()
    expect(screen.getByText('₹12.50')).toBeInTheDocument()
    expect(screen.getAllByText('₹1,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 Nov 2026/).length).toBeGreaterThan(0)
  })

  it('shows the amount plus 18% GST and what the owner pays, on the Pay button', () => {
    view()
    expect(screen.getByText(/₹1,000 credit \+ ₹180 GST \(18%\) = you pay/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay ₹1,180' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '₹2,500' }))
    expect(screen.getByText(/₹2,500 credit \+ ₹450 GST \(18%\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay ₹2,950' })).toBeInTheDocument()
  })

  it('rejects amounts under the minimum', () => {
    view()
    fireEvent.change(screen.getByLabelText('Custom amount'), { target: { value: '50' } })
    expect(screen.getByText('The minimum top-up is ₹100.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled()
  })

  it('lists wallet activity with signed amounts and labels', () => {
    view()
    expect(screen.getAllByText('Top-up').length).toBeGreaterThan(0)
    expect(screen.getAllByText('+₹1,000.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('−₹12.50').length).toBeGreaterThan(0)
  })

  it('shows the empty state when the wallet has no activity', () => {
    view({ initial: { balance: 0, ledger: [] } })
    expect(screen.getByText('No wallet activity yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse services' })).toHaveAttribute('href', '/dashboard/services')
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('opens Razorpay checkout for the order, verifies the payment and confirms', async () => {
    const opened: any[] = []
    ;(window as any).Razorpay = class {
      opts: any
      constructor(opts: any) {
        this.opts = opts
        opened.push(opts)
      }
      open() {
        this.opts.handler({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 'sig' })
      }
    }
    const f = vi.fn<(...a: any[]) => any>(async (url: string) => ({
      ok: true,
      json: async () => (url.endsWith('create-order') ? { orderId: 'order_1', amount: 118000, currency: 'INR', keyId: 'rzp_test_y' } : { ok: true }),
    }))
    vi.stubGlobal('fetch', f)
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹1,180' }))
    expect(await screen.findByText(/Added ₹1,000 to your wallet/)).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ amountInr: 1000 })
    expect(opened[0]).toMatchObject({ key: 'rzp_test_y', amount: 118000, order_id: 'order_1', description: 'Wallet top-up · Acme' })
    expect(f.mock.calls[1][0]).toBe('/api/ecom/wallet/topup/verify')
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the API error when the order cannot be created', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'Amount too high' }) }))
    view()
    fireEvent.click(screen.getByRole('button', { name: /^Pay ₹/ }))
    expect(await screen.findByText('Amount too high')).toBeInTheDocument()
  })

  it('shows the cancellation when checkout is dismissed', async () => {
    ;(window as any).Razorpay = class {
      opts: any
      constructor(opts: any) {
        this.opts = opts
      }
      open() {
        this.opts.modal.ondismiss()
      }
    }
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ orderId: 'o', amount: 1, currency: 'INR' }) }))
    view()
    fireEvent.click(screen.getByRole('button', { name: /^Pay ₹/ }))
    expect(await screen.findByText('Payment cancelled')).toBeInTheDocument()
  })

  it('pays by UPI when UPI is enabled, without creating a Razorpay order', () => {
    const f = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', f)
    view({ upiEnabled: true })
    expect(screen.getByRole('button', { name: /UPI \(selected\)/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Pay ₹/ }))
    expect(upiStart).toHaveBeenCalledWith({ purpose: 'ecom_wallet_topup', amountInr: 1000 })
    expect(f).not.toHaveBeenCalled()
  })
})

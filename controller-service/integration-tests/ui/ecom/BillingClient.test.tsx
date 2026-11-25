import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import BillingClient from '@controller/app/(ecom)/ecom/dashboard/billing/BillingClient'

const original = window.location
afterEach(() => {
  Object.defineProperty(window, 'location', { value: original, writable: true })
})

const plans = [
  { slug: 'basic', name: 'Basic', tier: 1, monthly_price_inr: '999' },
  { slug: 'pro', name: 'Pro', tier: 3, monthly_price_inr: '2999' },
]
const tenant = (over: Record<string, unknown> = {}) =>
  ({ id: 't1', slug: 'acme', plan: 'basic', billing_interval: 'monthly', payment_required: true, razorpay_subscription_id: 'sub_1', subscription_status: 'active', pending_plan: null, store_request: null, ...over }) as any
const line = (over: Record<string, unknown> = {}) => ({ id: 'l1', kind: 'store_plan', label: 'Basic plan', status: 'active', amountPaise: 117882, ...over })
const overview = (over: Record<string, unknown> = {}) =>
  ({
    current: { status: 'active', interval: 'monthly', amountPaise: 117882, currentEnd: '2026-12-05T00:00:00Z', startAt: null, paymentMethod: 'upi', checkoutUrl: null, graceUntil: null },
    pending: null,
    lines: [line()],
    legacy: 0,
    monthlyPaise: 117882,
    cyclePaise: 117882,
    ...over,
  }) as any
const view = (props: Partial<React.ComponentProps<typeof BillingClient>> = {}) =>
  render(
    <ToastProvider>
      <BillingClient tenant={tenant()} plans={plans} overview={overview()} isStore {...props} />
    </ToastProvider>,
  )
const mockFetch = (ok: boolean, body: any) => {
  const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}

describe('BillingClient', () => {
  it('shows the plan, status, next charge, payment method and the line total incl. GST', () => {
    view()
    expect(screen.getByText('Current subscription')).toBeInTheDocument()
    expect(screen.getAllByText('Basic').length).toBeGreaterThan(0)
    expect(screen.getByText('Monthly billing')).toBeInTheDocument()
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getByText('₹1,178.82 on 5 Dec 2026')).toBeInTheDocument()
    expect(screen.getByText('UPI Autopay')).toBeInTheDocument()
    expect(screen.getByText('Basic plan')).toBeInTheDocument()
    expect(screen.getByText('Monthly total (incl. GST)')).toBeInTheDocument()
    expect(screen.getAllByText('₹1,178.82/mo').length).toBeGreaterThan(0)
  })

  it('breaks the plan price down as plan + servers incl. GST when there is no store line', () => {
    view({ overview: overview({ lines: [] }), priceInrMonth: 1500 })
    expect(screen.getByText(/Plan ₹999 \+ servers ₹501 \(incl\. GST\)/)).toHaveTextContent('₹1,500/mo')
  })

  it('shows yearly totals and the yearly price for yearly billing', () => {
    view({ tenant: tenant({ billing_interval: 'yearly' }), overview: overview({ current: { ...overview().current, interval: 'yearly' }, lines: [], cyclePaise: 1178820 }), priceInrMonth: 1500 })
    expect(screen.getByText('Yearly billing')).toBeInTheDocument()
    expect(screen.getByText(/billed ₹15,000\/yr/)).toBeInTheDocument()
  })

  it('shows that billing starts later for an optional-payment store with no subscription', () => {
    view({ tenant: tenant({ payment_required: false, razorpay_subscription_id: null }), overview: overview({ current: null, lines: [] }), priceInrMonth: 1500 })
    expect(screen.getByText('Not billed yet')).toBeInTheDocument()
    expect(screen.getByText(/billing starts later/)).toBeInTheDocument()
  })

  it('shows a pending plan move and a link to Plan & servers', () => {
    view({ tenant: tenant({ pending_plan: 'pro', pending_billing_interval: 'yearly' }) })
    expect(screen.getByText(/Moves to/)).toHaveTextContent('Pro (yearly) at the next renewal')
    expect(screen.getByRole('link', { name: /Plan & servers/ })).toHaveAttribute('href', '/dashboard/compute')
  })

  it('asks the owner to approve a created subscription on Razorpay', () => {
    view({ overview: overview({ current: { ...overview().current, status: 'created', checkoutUrl: 'https://rzp.io/approve' } }) })
    expect(screen.getByText('Awaiting approval', { selector: 'span.rounded-full' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Approve payment' })).toHaveAttribute('href', 'https://rzp.io/approve')
  })

  it('offers to update the payment method after a failed charge', () => {
    view({ overview: overview({ current: { ...overview().current, status: 'pending', checkoutUrl: 'https://rzp.io/update' } }) })
    expect(screen.getByText(/last payment didn't go through/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Update payment method' })).toHaveAttribute('href', 'https://rzp.io/update')
  })

  it('a halted subscription shows the switch-off date and Pay now opens Razorpay', async () => {
    const loc = { href: '' }
    Object.defineProperty(window, 'location', { value: loc, writable: true })
    const f = mockFetch(true, { checkoutUrl: 'https://rzp.io/pay' })
    view({ overview: overview({ current: { ...overview().current, status: 'halted', graceUntil: '2026-12-10T00:00:00Z' } }) })
    expect(screen.getByText(/switch off on 10 Dec 2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pay now' }))
    expect(await screen.findByText('Opening Razorpay to complete the payment…')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/billing/subscription?tenant=acme')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ action: 'pay_now' })
    expect(loc.href).toBe('https://rzp.io/pay')
  })

  it('Pay now shows the API error', async () => {
    mockFetch(false, { error: 'Already paid' })
    view({ overview: overview({ current: { ...overview().current, status: 'halted' } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Pay now' }))
    expect(await screen.findByText('Already paid')).toBeInTheDocument()
  })

  it('shows a plan change waiting for approval with the upfront amount', () => {
    view({ overview: overview({ pending: { checkoutUrl: 'https://rzp.io/chg', amountPaise: 299900, interval: 'monthly', startAt: '2027-01-01T00:00:00Z', upfrontPaise: 50000 } }) })
    expect(screen.getByText(/A change is waiting for your approval/)).toBeInTheDocument()
    expect(screen.getByText(/New total ₹2,999\/mo from 1 Jan 2027, plus ₹500 now/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Approve' })).toHaveAttribute('href', 'https://rzp.io/chg')
  })

  it('links wallet-paid items to the subscription setup', () => {
    view({ overview: overview({ legacy: 2 }) })
    expect(screen.getByText(/2 items are still paid from your wallet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up subscription' })).toHaveAttribute('href', '/dashboard/billing/subscribe?tenant=acme')
  })

  it('a store can be closed: confirm, then post the deprovision and refresh', async () => {
    const f = mockFetch(true, {})
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }))
    expect(screen.getByText(/closes your store at cycle end/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }))
    expect(await screen.findByText(/your store stays live until the end of the current billing cycle/)).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/provisioning')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ action: 'deprovision', tenantId: 't1' })
    expect(refresh).toHaveBeenCalled()
  })

  it('"Keep subscription" backs out of the cancellation', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep subscription' }))
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes, cancel' })).toBeNull()
  })

  it('a Showcase-only workspace cancels everything at cycle end', async () => {
    const f = mockFetch(true, overview({ current: { ...overview().current, status: 'cancelled' } }))
    view({ isStore: false, tenant: tenant({ razorpay_subscription_id: null }), overview: overview({ lines: [line({ kind: 'showcase_site', label: 'Showcase: acme.jeffi.site' })] }) })
    expect(screen.getAllByText('Showcase').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }))
    expect(await screen.findByText(/Your sites stay online until the end of this billing cycle/)).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ action: 'cancel' })
  })

  it('hides the cancel section for an already ended subscription', () => {
    view({ tenant: tenant({ subscription_status: 'cancelled' }) })
    expect(screen.queryByRole('button', { name: 'Cancel subscription' })).toBeNull()
  })

  it('describes line notes: trial end, ending date and included Showcase', () => {
    view({
      overview: overview({
        lines: [
          line({ id: 'a', kind: 'showcase_site', label: 'Site A', status: 'trial', trialEndsAt: '2026-12-01T00:00:00Z', amountPaise: 20000 }),
          line({ id: 'b', kind: 'addon', label: 'Add-on B', status: 'ending', endsAt: '2026-12-20T00:00:00Z' }),
          line({ id: 'c', kind: 'showcase_site', label: 'Site C', amountPaise: 0 }),
        ],
      }),
    })
    expect(screen.getByText('Free until 1 Dec 2026')).toBeInTheDocument()
    expect(screen.getByText('Ends on 20 Dec 2026')).toBeInTheDocument()
    expect(screen.getByText('Included in your store plan')).toBeInTheDocument()
  })
})

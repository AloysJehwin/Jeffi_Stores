'use client'

import Link from 'next/link'
import { useCheckoutParts, type CheckoutParts } from './context'
import {
  BackToReview,
  CheckoutError,
  CheckoutMobileBar,
  CheckoutUpiDialog,
  DeliveryAddress,
  OrderItemsList,
  OrderNotes,
  PaymentMethod,
  PlaceOrderButton,
  SummaryLines,
} from './pieces'
import { demoTotal, type DemoLine } from '../cart/demo'
import { DemoTotals, money } from '../cart/demo-ui'

// The checkout parts an AI checkout page places. They read the page's one checkout state (CheckoutProvider); only
// PaymentStep submits, through the checkout's own form, button and payment flow. With no checkout (the studio
// preview) each shows sample content, inert.

/** The checkout state once the order can be shown (null while it loads), and whether there is no checkout at all. */
function useReady(): { c: CheckoutParts | null; outside: boolean } {
  const c = useCheckoutParts()
  return { c: c?.phase === 'ready' ? c : null, outside: c === null }
}

const DEMO_ADDRESS = { name: 'Asha Verma', line1: '12, Lake View Road, Indiranagar', city: 'Bengaluru, Karnataka 560038', phone: '+91 98450 12345', email: 'asha@example.com' }

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground break-words">{value || '—'}</dd>
    </div>
  )
}

/** The shopper's contact details for this order: name and phone from the delivery address, email from the account. */
export function ContactFormPart({ className, demo = false }: { className?: string; demo?: boolean }) {
  const { c, outside } = useReady()
  if (!c && !(outside && demo)) return null
  const name = c ? c.address?.full_name || [c.user?.firstName, c.user?.lastName].filter(Boolean).join(' ') : DEMO_ADDRESS.name
  return (
    <div className={className}>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Name" value={name} />
        <Field label="Email" value={c ? c.user?.email : DEMO_ADDRESS.email} />
        <Field label="Phone" value={c ? c.address?.phone || c.user?.phone : DEMO_ADDRESS.phone} />
      </dl>
      <Link href="/checkout/review" className="inline-block mt-3 text-sm font-medium text-accent-600 dark:text-accent-400 hover:text-accent-700">
        Change
      </Link>
    </div>
  )
}

/** The delivery address chosen on the review step, with Change back to it. */
export function AddressFormPart({ className, demo = false }: { className?: string; demo?: boolean }) {
  const { c, outside } = useReady()
  if (c)
    return (
      <div className={className}>
        <DeliveryAddress c={c} />
      </div>
    )
  if (!outside || !demo) return null
  return (
    <div className={className}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-foreground">Delivery Address</h2>
        <span className="text-accent-600 dark:text-accent-400 text-sm font-medium">Change</span>
      </div>
      <div className="bg-surface p-4 rounded-lg">
        <p className="font-semibold text-foreground">{DEMO_ADDRESS.name}</p>
        <p className="text-foreground-secondary mt-2">{DEMO_ADDRESS.line1}</p>
        <p className="text-foreground-secondary">{DEMO_ADDRESS.city}</p>
        <p className="text-foreground-secondary mt-2">Phone: {DEMO_ADDRESS.phone}</p>
      </div>
    </div>
  )
}

/** Delivery for this address (the charge the store's rates give, any COD fee) and the order notes field. */
export function DeliveryOptionsPart({ notes = true, className, demo = false }: { notes?: boolean; className?: string; demo?: boolean }) {
  const { c, outside } = useReady()
  if (!c && !(outside && demo)) return null
  const charge = c ? c.shippingCharge : 0
  return (
    <div className={className}>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-foreground-secondary">Delivery</span>
          <span className="font-medium text-foreground">{charge == null ? 'Calculating…' : charge === 0 ? 'Free' : money(charge)}</span>
        </div>
        {c && c.paymentMethod === 'cod' && c.codFee > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-foreground-secondary">COD handling fee</span>
            <span className="font-medium text-foreground">{money(c.codFee)}</span>
          </div>
        )}
      </div>
      {notes &&
        (c ? (
          <div className="mt-4">
            <OrderNotes c={c} />
          </div>
        ) : (
          <div className="mt-4">
            <h2 className="text-xl font-bold text-foreground mb-4">Order Notes (Optional)</h2>
            <div className="w-full h-24 px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground-muted">
              Any special instructions or requests...
            </div>
          </div>
        ))}
    </div>
  )
}

/** The lines being paid for and the totals (subtotal, GST, coupon, delivery, COD fee, total). */
export function OrderSummaryPart({ items = true, className, demo = [] }: { items?: boolean; className?: string; demo?: DemoLine[] }) {
  const { c, outside } = useReady()
  if (c)
    return (
      <div className={className}>
        {items && (
          <div className="mb-6">
            <OrderItemsList c={c} />
          </div>
        )}
        <SummaryLines c={c} />
      </div>
    )
  if (!outside || !demo.length) return null
  return (
    <div className={className}>
      {items && (
        <div className="space-y-4 mb-6">
          {demo.map(l => (
            <div key={l.id} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0">
              <div className="w-20 h-20 bg-surface-secondary rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
                {l.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.image} alt={l.name} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground">{l.name}</h3>
                <p className="text-sm text-foreground-secondary mt-1">
                  {money(l.price)} × {l.qty}
                </p>
                <p className="text-sm font-semibold text-foreground mt-1">{money(l.price * l.qty)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <DemoTotals lines={demo} delivery />
    </div>
  )
}

/** At checkout the coupon comes from the cart: show it when one applies, else point back to the cart. */
export function CheckoutCoupon({ c, className }: { c: CheckoutParts; className?: string }) {
  if (c.phase !== 'ready') return null
  if (c.couponCode && c.discountAmount > 0)
    return (
      <div className={className}>
        <div className="flex items-center justify-between gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
          <p className="text-sm font-semibold text-green-700 dark:text-green-400">{c.couponCode} applied</p>
          <span className="text-sm font-medium text-green-700 dark:text-green-400">−{money(c.discountAmount)}</span>
        </div>
      </div>
    )
  if (c.isBuyNow) return null
  return (
    <div className={className}>
      <p className="text-sm text-foreground-secondary">
        Have a coupon?{' '}
        <Link href="/cart" className="font-medium text-accent-600 dark:text-accent-400 hover:text-accent-700">
          Apply it in your cart
        </Link>
      </p>
    </div>
  )
}

/**
 * The locked payment step: the store's own payment choices, the place-order / pay button, the phone bottom bar and the
 * UPI dialog, in the checkout's one form. It takes no settings, so nothing in a design changes how an order is paid.
 */
export function PaymentStepPart({ demo = [] }: { demo?: DemoLine[] }) {
  const { c, outside } = useReady()
  if (c?.builtInPayment) return null
  if (c)
    return (
      <div data-payment-step>
        <form onSubmit={c.handleSubmitOrder}>
          <CheckoutError c={c} />
          <div className="mb-6">
            <PaymentMethod c={c} />
          </div>
          <PlaceOrderButton c={c} />
          <BackToReview />
          <CheckoutMobileBar c={c} />
        </form>
        <CheckoutUpiDialog c={c} />
      </div>
    )
  if (!outside) return null
  const total = demoTotal(demo)
  return (
    <div data-payment-step aria-hidden>
      <h2 className="text-xl font-bold text-foreground mb-4">Payment Method</h2>
      <div className="space-y-3">
        {['UPI', 'Cards, netbanking and wallets', 'Cash on delivery'].map((label, i) => (
          <div key={label} className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${i === 0 ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default'}`}>
            <span className={`w-4 h-4 rounded-full border-2 ${i === 0 ? 'border-accent-500 bg-accent-500' : 'border-border-secondary'}`} />
            <span className="text-sm font-medium text-foreground">{label}</span>
          </div>
        ))}
      </div>
      <span className="mt-6 w-full bg-accent-500 text-white px-6 py-3 rounded-lg font-semibold flex items-center justify-center">
        {total > 0 ? `Pay ${money(total)}` : 'Place Order'}
      </span>
    </div>
  )
}

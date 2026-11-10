import { Sk } from '@/components/admin/kit/skeleton'

// Cart, checkout and order-review loading screens, shared by the storefront and the business portal.

const CARD = 'bg-surface-elevated rounded-lg shadow-sm border border-border-default'
const PAGE = 'bg-surface min-h-screen py-4 sm:py-6 lg:py-8'
const H1 = 'text-3xl font-bold text-foreground mb-4 sm:mb-6 lg:mb-8'
const GRID = 'grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8'

function Row({ label, value = 'w-20', className = 'text-foreground-secondary' }: { label: string; value?: string; className?: string }) {
  return (
    <div className={`flex justify-between items-center ${className}`}>
      <span>{label}</span>
      <Sk className={`h-4 ${value}`} />
    </div>
  )
}

function TotalBlock() {
  return (
    <div className="border-t border-border-default pt-3">
      <div className="flex justify-between items-center text-lg font-bold text-foreground">
        <span>Total</span>
        <Sk className="h-6 w-24" />
      </div>
      <p className="text-xs text-foreground-muted mt-1">Price inclusive of all taxes</p>
    </div>
  )
}

function CartItemRow() {
  return (
    <div className="p-4 sm:p-6 border-b border-border-default last:border-b-0">
      <div className="flex gap-4 sm:gap-6">
        <Sk className="w-24 h-24 rounded-lg flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <Sk className="h-5 w-3/4" />
          <Sk className="h-3.5 w-1/3 mt-2" />
          <Sk className="h-6 w-24 mt-3" />
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <Sk className="h-10 w-32 rounded-lg" />
            <span className="text-foreground-secondary text-sm font-medium">Save for later</span>
            <span className="text-red-600 text-sm font-medium">Remove</span>
          </div>
          <div className="mt-4 flex items-center gap-1">
            <span className="text-sm text-foreground-secondary">Subtotal: </span>
            <Sk className="h-5 w-20" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** /cart: "Shopping Cart", the item rows and the order summary with its coupon box. */
export function CartSkeleton({ sticky = 'lg:top-24' }: { sticky?: string }) {
  return (
    <div className={PAGE} role="status" aria-busy="true" aria-label="Loading cart">
      <div className="container mx-auto px-4">
        <h1 className={H1}>Shopping Cart</h1>
        <div className={GRID}>
          <div className="lg:col-span-2">
            <div className={CARD}>
              {Array.from({ length: 3 }).map((_, i) => (
                <CartItemRow key={i} />
              ))}
            </div>
          </div>
          <div className={`lg:col-span-1 lg:self-start lg:sticky ${sticky}`}>
            <div className={`${CARD} p-4 sm:p-6`}>
              <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>
              <div className="mb-5 flex gap-2">
                <div className="flex-1 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground-muted">
                  Coupon code
                </div>
                <span className="px-4 py-2 text-sm font-semibold bg-accent-500 text-white rounded-lg">Apply</span>
              </div>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center text-foreground-secondary">
                  <span className="flex items-center gap-1">
                    Subtotal (<Sk className="inline-block h-4 w-12" />)
                  </span>
                  <Sk className="h-4 w-20" />
                </div>
                <TotalBlock />
              </div>
              <Sk className="h-12 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const TRUST = [
  ['Secure Checkout', '256-bit SSL encryption'],
  ['Easy Returns', '7-day return policy'],
  ['Genuine Products', '100% authentic items'],
  ['24×7 Support', 'Always here to help'],
]

function OptionRow() {
  return (
    <div className="flex items-center gap-4 p-4 border-2 border-border-default rounded-lg">
      <span className="w-4 h-4 rounded-full border border-border-strong shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Sk className="h-4 w-32" />
        <Sk className="h-3.5 w-48 max-w-full" />
      </div>
      <Sk className="w-8 h-8 rounded-lg" />
    </div>
  )
}

/** /checkout ("Place Order"): items, address, notes, payment, the trust strip and the summary. */
export function CheckoutSkeleton() {
  return (
    <div className={PAGE} role="status" aria-busy="true" aria-label="Loading checkout">
      <div className="container mx-auto px-4">
        <h1 className={H1}>Place Order</h1>
        <div className={GRID}>
          <div className="lg:col-span-2">
            <div className={`${CARD} p-4 sm:p-6 mb-8`}>
              <h2 className="text-xl font-bold text-foreground mb-6">Order Items</h2>
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0 last:pb-0">
                    <Sk className="w-20 h-20 rounded-lg flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Sk className="h-4 w-3/4" />
                      <Sk className="h-3.5 w-1/3" />
                      <Sk className="h-4 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className={`${CARD} p-4 sm:p-6 mb-8`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-foreground">Delivery Address</h2>
                <span className="text-accent-500 text-sm font-medium">Change</span>
              </div>
              <div className="bg-surface p-4 rounded-lg space-y-2">
                <Sk className="h-4 w-40" />
                <Sk className="h-3.5 w-3/4" />
                <Sk className="h-3.5 w-1/2" />
              </div>
            </div>
            <div className={`${CARD} p-4 sm:p-6 mb-8`}>
              <h2 className="text-xl font-bold text-foreground mb-4">Order Notes (Optional)</h2>
              <div className="w-full h-24 px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground-muted">
                Any special instructions or requests...
              </div>
            </div>
            <div className={`${CARD} p-4 sm:p-6 mb-8`}>
              <h2 className="text-xl font-bold text-foreground mb-4">Payment Method</h2>
              <div className="space-y-3">
                <OptionRow />
                <OptionRow />
              </div>
            </div>
            <div className="mt-8 bg-surface-elevated rounded-lg border border-border-default p-4">
              <div className="grid grid-cols-2 gap-3">
                {TRUST.map(([title, sub]) => (
                  <div key={title} className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-green-50 dark:bg-green-900/20 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{title}</p>
                      <p className="text-xs text-foreground-muted">{sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-20">
            <div className={`${CARD} p-4 sm:p-6`}>
              <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>
              <div className="space-y-3 mb-6">
                <Row label="Subtotal" />
                <Row label="Delivery" value="w-12" className="text-foreground-secondary text-sm" />
                <TotalBlock />
              </div>
              <div className="border-t border-border-default pt-6 mb-6">
                <h3 className="font-semibold text-foreground mb-4">Contact Us</h3>
                <div className="space-y-3">
                  <Sk className="h-4 w-40" />
                  <Sk className="h-4 w-48" />
                </div>
              </div>
              <Sk className="h-12 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** /checkout/review ("Order Review"), rendered by CheckoutReviewPage. */
export function CheckoutReviewSkeleton() {
  return (
    <div className={PAGE} role="status" aria-busy="true" aria-label="Loading order review">
      <div className="container mx-auto px-4">
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <h1 className="text-3xl font-bold text-foreground">Order Review</h1>
          <p className="text-foreground-secondary mt-2">Review your order details before placing the order</p>
        </div>
        <div className={GRID}>
          <div className="lg:col-span-2 space-y-6">
            <div className={`${CARD} p-4 sm:p-6`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-foreground">Delivery Address</h2>
                <span className="text-accent-500 text-sm font-medium">+ Add New Address</span>
              </div>
              <div className="space-y-3">
                <Sk className="h-20 rounded-lg" />
                <Sk className="h-20 rounded-lg" />
              </div>
            </div>
            <div className={`${CARD} p-4 sm:p-6`}>
              <h2 className="flex items-center gap-1 text-xl font-bold text-foreground mb-6">
                Order Items (<Sk className="inline-block h-5 w-14" />)
              </h2>
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex gap-4">
                    <Sk className="w-20 h-20 rounded-lg flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Sk className="h-4 w-3/4" />
                      <Sk className="h-3.5 w-1/3" />
                      <Sk className="h-4 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6">
              <div className="flex items-start gap-4">
                <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Sk className="h-3.5 w-28" />
                  <Sk className="h-5 w-48" />
                </div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-24">
            <div className={`${CARD} p-4 sm:p-6`}>
              <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>
              <div className="space-y-3 mb-6">
                <Row label="Subtotal" />
                <Row label="Delivery Charges" value="w-12" />
                <TotalBlock />
              </div>
              <div className="mb-4">
                <p className="block text-sm font-medium text-foreground-secondary mb-1.5">Have a coupon?</p>
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground-muted text-sm">
                    Enter code
                  </div>
                  <span className="px-4 py-2 bg-accent-500 text-white rounded-lg text-sm font-semibold">Apply</span>
                </div>
              </div>
              <div className="mb-4">
                <p className="block text-sm font-medium text-foreground-secondary mb-1.5">Order Notes (Optional)</p>
                <div className="w-full h-[5.25rem] px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground-muted text-sm">
                  Any special instructions...
                </div>
              </div>
              <div className="mb-4 space-y-2">
                <p className="text-sm font-medium text-foreground-secondary">Payment Method</p>
                <Sk className="h-14 w-full rounded-lg" />
                <Sk className="h-14 w-full rounded-lg" />
              </div>
              <Sk className="h-12 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Saved-address choices while SubscribeCheckout loads them. */
export function SubscribeAddressesSkeleton() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex gap-3 p-3 rounded-lg border border-border-default">
          <span className="w-3.5 h-3.5 mt-0.5 rounded-full border border-border-strong shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Sk className="h-4 w-28" />
            <Sk className="h-3.5 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The per-cycle summary while the quote loads. */
export function SubscribeQuoteSkeleton() {
  return (
    <div className="text-sm space-y-2">
      {['w-32', 'w-20', 'w-16'].map((w, i) => (
        <div key={i} className="flex justify-between">
          <Sk className="h-4 w-24" />
          <Sk className={`h-4 ${w}`} />
        </div>
      ))}
      <div className="flex justify-between font-semibold border-t border-border-default pt-2">
        <span>Total per cycle</span>
        <Sk className="h-4 w-20" />
      </div>
    </div>
  )
}

/** /subscribe ("Start your subscription"). */
export function SubscribeSkeleton() {
  return (
    <div className="container mx-auto px-4 py-6" role="status" aria-busy="true" aria-label="Loading subscription">
      <h1 className="text-2xl font-bold text-foreground mb-4">Start your subscription</h1>
      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <section className="lg:col-span-2 bg-surface-elevated rounded-lg border border-border-default p-4">
          <div className="flex items-center justify-between mb-3">
            <Sk className="h-5 w-32" />
            <span className="text-sm text-accent-600 font-medium">+ Add new</span>
          </div>
          <SubscribeAddressesSkeleton />
        </section>
        <section className="lg:sticky lg:top-4 bg-surface-elevated rounded-lg border border-border-default p-4 space-y-3">
          <h2 className="font-semibold text-foreground">Each cycle</h2>
          <SubscribeQuoteSkeleton />
          <div className="space-y-1.5">
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-2/3" />
          </div>
          <Sk className="h-12 w-full rounded-lg" />
        </section>
      </div>
    </div>
  )
}

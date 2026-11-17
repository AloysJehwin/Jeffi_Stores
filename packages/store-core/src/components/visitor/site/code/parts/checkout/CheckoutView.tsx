'use client'

import type { ReactNode } from 'react'
import FeaturedForYou from '@/components/visitor/FeaturedForYou'
import { CheckoutSkeleton } from '@/components/visitor/skeletons/commerce'
import { CheckoutProvider, useCheckoutParts } from './context'
import {
  BackToReview,
  CARD,
  CheckoutError,
  CheckoutMobileBar,
  CheckoutUpiDialog,
  DeliveryAddress,
  OrderItemsList,
  OrderNotes,
  PaymentMethod,
  PlaceOrderButton,
  StoreContact,
  SummaryLines,
  TrustStrip,
} from './pieces'

/**
 * What shows until the order can be shown: "confirming your payment" while a payment from before a reload is checked,
 * the skeleton while the order loads (or redirects away), then the checkout itself.
 */
export function CheckoutGate({ children }: { children: ReactNode }) {
  const c = useCheckoutParts()
  if (!c) return <>{children}</>
  if (c.phase === 'verifying')
    return (
      <div className="min-h-screen bg-surface px-4 py-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-surface-elevated rounded-xl border border-border-default p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-accent-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Confirming your payment…</h2>
          <p className="text-sm text-foreground-secondary">
            Your payment was received. We&apos;re confirming your order — please don&apos;t close this page.
          </p>
          <button
            type="button"
            className="text-sm text-accent-600 hover:underline"
            onClick={c.retryVerify}
          >
            Retry confirmation
          </button>
        </div>
      </div>
    )
  if (c.phase === 'loading') return <CheckoutSkeleton />
  return <>{children}</>
}

/** The built-in checkout page: the same layout the store has always had, over the shared checkout state. */
export default function CheckoutView() {
  return (
    <CheckoutProvider>
      <CheckoutGate>
        <BuiltInCheckout />
      </CheckoutGate>
    </CheckoutProvider>
  )
}

function BuiltInCheckout() {
  const c = useCheckoutParts()!
  return (
    <div className="bg-surface min-h-screen py-4 sm:py-6 lg:py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-foreground mb-4 sm:mb-6 lg:mb-8">Place Order</h1>

        <CheckoutError c={c} />

        <form onSubmit={c.handleSubmitOrder}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            <div className="lg:col-span-2">
              {/* Order Items Summary */}
              <div className={`${CARD} mb-8`}>
                <h2 className="text-xl font-bold text-foreground mb-6">Order Items</h2>
                <OrderItemsList c={c} />
              </div>

              {/* Delivery Address */}
              <div className={`${CARD} mb-8`}>
                <DeliveryAddress c={c} />
              </div>

              {/* Order Notes */}
              <div className={`${CARD} mb-8`}>
                <OrderNotes c={c} />
              </div>

              {/* Payment Method */}
              <div className={`${CARD} mb-8`}>
                <PaymentMethod c={c} />
              </div>

              {/* Trust & Security Strip */}
              <TrustStrip />
            </div>

            {/* Order Summary & Contact */}
            <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-20">
              <div className={CARD}>
                <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>

                <SummaryLines c={c} />

                {/* Contact Information */}
                <StoreContact c={c} />

                <PlaceOrderButton c={c} />

                <BackToReview />
              </div>
            </div>
          </div>

          <CheckoutMobileBar c={c} />
        </form>
        <CheckoutUpiDialog c={c} />
      </div>
      <div className="container mx-auto px-4 pb-8">
        <FeaturedForYou compact limit={4} />
      </div>
    </div>
  )
}

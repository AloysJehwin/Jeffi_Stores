'use client'

import FeaturedForYou from '@/components/visitor/FeaturedForYou'
import CartInsightPanel from '@/components/storefront-ai/CartInsightPanel'
import FreeShippingProgress from '@/components/visitor/cart/FreeShippingProgress'
import CartUpsellRow from '@/components/visitor/cart/CartUpsellRow'
import { CartSkeleton } from '@/components/visitor/skeletons/commerce'
import { CartPartsProvider, useCartParts } from './context'
import {
  CartEmptyPage,
  CartLineList,
  CartLinesEmptyBox,
  CartMobileBar,
  CheckoutCta,
  ContinueShopping,
  CouponInput,
  SavedForLater,
  SummaryTotals,
} from './pieces'

/** The built-in cart page: the same layout the store has always had, over the shared cart state. */
export default function CartView() {
  return (
    <CartPartsProvider>
      <BuiltInCart />
    </CartPartsProvider>
  )
}

function BuiltInCart() {
  const c = useCartParts()!
  const { cartItems, savedItems, cartCount, isLoading, couponNotice, physicalTotal } = c

  if (isLoading) return <CartSkeleton />

  if (cartCount === 0 && savedItems.length === 0) return <CartEmptyPage couponNotice={couponNotice} />

  return (
    <div className="bg-surface min-h-screen py-4 sm:py-6 lg:py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-foreground mb-4 sm:mb-6 lg:mb-8">Shopping Cart</h1>
        {couponNotice}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            <FreeShippingProgress subtotal={physicalTotal} />
            {cartItems.length === 0 ? <CartLinesEmptyBox /> : <CartLineList c={c} />}

            <SavedForLater c={c} />

            <CartInsightPanel
              items={cartItems.map(i => ({
                name: i.products?.name || '',
                brand: i.products?.brand_name || null,
                category: null,
                qty: Number(i.quantity),
              }))}
            />

            <CartUpsellRow cartProductIds={cartItems.map(i => i.product_id)} savedProductIds={savedItems.map(i => i.product_id)} />

            <FeaturedForYou compact limit={4} />
          </div>

          {/* Order Summary */}
          {cartItems.length > 0 && (
            <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-24">
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
                <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>

                {/* Coupon Input */}
                <div className="mb-5">
                  <CouponInput c={c} />
                </div>

                <SummaryTotals c={c} />

                <CheckoutCta c={c} />

                <ContinueShopping />
              </div>
            </div>
          )}
        </div>
      </div>

      <CartMobileBar c={c} />
    </div>
  )
}

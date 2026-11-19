'use client'

import Link from 'next/link'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import CopySku from '@/components/ui/CopySku'
import MobileCheckoutBar from '@/components/visitor/cart/MobileCheckoutBar'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { PaymentSections, UpiManualDialog } from '@/components/payments'
import type { CheckoutParts } from './context'
import { badgeColumns } from './TrustBadges'

// The checkout's markup, cut from the old CheckoutClient into pieces the built-in checkout and the AI parts both place.

type P = { c: CheckoutParts }
export const CARD = 'bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6'

function UnitLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null
  const match = label.match(/^(.+?)2$/)
  if (match)
    return (
      <>
        {match[1]}
        <sup>2</sup>
      </>
    )
  return <>{label}</>
}

/** The order could not start: the message, and for a pending earlier order, go to it or cancel it. */
export function CheckoutError({ c }: P) {
  const { error, existingOrder, handleCancelPreviousOrder, isCancellingPrevious } = c
  if (!error) return null
  return (
    <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
      <p>{error}</p>
      {existingOrder && (
        <div className="flex flex-wrap gap-3 mt-3">
          <Link
            href={`/account/orders/${existingOrder.id}`}
            className="inline-flex items-center px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Go to Order #{existingOrder.orderNumber}
          </Link>
          <button
            type="button"
            onClick={handleCancelPreviousOrder}
            disabled={isCancellingPrevious}
            className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:bg-red-300"
          >
            {isCancellingPrevious ? 'Cancelling...' : 'Cancel Previous Order'}
          </button>
        </div>
      )}
    </div>
  )
}

/** The lines being paid for: the buy-now item, or the cart's lines. */
export function OrderItemsList({ c }: P) {
  const { isBuyNow, buyNowItem, cartItems, gstEnabled } = c
  return (
    <div className="space-y-4">
      {isBuyNow && buyNowItem ? (
        <div className="flex gap-4 pb-4">
          <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
            {buyNowItem.imageUrl ? (
              <ImgWithSkeleton
                src={buyNowItem.imageUrl}
                alt={buyNowItem.productName}
                className="w-full h-full object-cover rounded-lg"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg
                  className="w-10 h-10 text-foreground-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground">{buyNowItem.productName}</h3>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {buyNowItem.brandName && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-secondary text-foreground-secondary border border-border-default">
                  {buyNowItem.brandName}
                </span>
              )}
              {buyNowItem.sku && (
                <span className="text-[10px] text-foreground-muted font-mono">
                  SKU: {buyNowItem.sku}
                  <CopySku sku={buyNowItem.sku} className="ml-1" />
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {buyNowItem.variantName && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700">
                  {buyNowItem.variantName}
                </span>
              )}
              {buyNowItem.subVariantName && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-secondary border border-border-default">
                  {buyNowItem.subVariantName}
                </span>
              )}
            </div>
            {(() => {
              const isBuyNowFractional =
                (buyNowItem.buyMode && buyNowItem.buyMode !== 'unit') ||
                !!(buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit')
              const effectiveBuyNowQty = isBuyNowFractional ? buyNowItem.qty : Math.round(buyNowItem.qty)
              const buyNowTotal = buyNowItem.price * effectiveBuyNowQty
              const displayUnit =
                buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit'
                  ? buyNowItem.buyUnit
                  : buyNowItem.buyMode !== 'unit'
                    ? buyNowItem.buyMode
                    : null
              return (
                <div className="flex items-center justify-between mt-2">
                  <p className="text-sm text-foreground-secondary">
                    ₹
                    {buyNowItem.price.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    ×{' '}
                    {isBuyNowFractional ? (
                      <>
                        {Number(Number(buyNowItem.qty).toFixed(6)).toString()}
                        {displayUnit ? (
                          <>
                            {' '}
                            <UnitLabel label={displayUnit} />
                          </>
                        ) : (
                          ''
                        )}
                      </>
                    ) : (
                      effectiveBuyNowQty
                    )}
                    {buyNowItem.mrp != null && buyNowItem.mrp > buyNowItem.price && (
                      <>
                        {' '}
                        <span className="line-through text-foreground-muted">
                          ₹
                          {buyNowItem.mrp.toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>{' '}
                        <span className="text-accent-600 dark:text-accent-400 font-semibold">
                          {Math.round(((buyNowItem.mrp - buyNowItem.price) / buyNowItem.mrp) * 100)}% off
                        </span>
                      </>
                    )}
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    ₹
                    {buyNowTotal.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>
              )
            })()}
            {gstEnabled &&
              buyNowItem.gstPercentage != null &&
              buyNowItem.gstPercentage > 0 &&
              (() => {
                const isBuyNowFractional =
                  (buyNowItem.buyMode && buyNowItem.buyMode !== 'unit') ||
                  !!(buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit')
                const lineTotal =
                  buyNowItem.price * (isBuyNowFractional ? buyNowItem.qty : Math.round(buyNowItem.qty))
                const gst = lineTotal - lineTotal / (1 + buyNowItem.gstPercentage / 100)
                return (
                  <p className="text-[11px] text-foreground-muted mt-0.5">
                    incl. ₹{gst.toLocaleString('en-IN', { minimumFractionDigits: 3 })} GST @{' '}
                    {buyNowItem.gstPercentage}%
                  </p>
                )
              })()}
          </div>
        </div>
      ) : (
        cartItems.map(item => {
          const primaryImage =
            item.products.product_images?.find((img: any) => img.is_primary) ||
            item.products.product_images?.[0]
          const isFractional = item.buy_mode && item.buy_mode !== 'unit'
          const price = !gstEnabled
            ? pickUnitPrice(
                {
                  inclusive: item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price,
                  exGst:
                    item.sub_variant?.price_ex_gst ??
                    item.variant?.price_ex_gst ??
                    item.products.price_ex_gst,
                },
                false
              )
            : isFractional
              ? item.price_at_addition
              : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
          const effectiveQty = isFractional ? Number(item.quantity) : Math.round(Number(item.quantity))
          const itemTotal = price * effectiveQty
          const mrp = item.sub_variant?.mrp ?? item.variant?.mrp ?? item.products.mrp ?? null
          const showMrp = mrp !== null && Number(mrp) > Number(price)
          const discountPct = showMrp ? Math.round(((Number(mrp) - Number(price)) / Number(mrp)) * 100) : 0
          const sku = item.sub_variant?.sku || item.variant?.sku || item.products.sku
          return (
            <div key={item.id} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0">
              <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
                {primaryImage ? (
                  <ImgWithSkeleton
                    src={primaryImage.thumbnail_url || primaryImage.image_url}
                    alt={item.products.name}
                    blurhash={primaryImage.blurhash}
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg
                      className="w-10 h-10 text-foreground-muted"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{item.products.name}</h3>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {item.products.brand_name && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-secondary text-foreground-secondary border border-border-default">
                      {item.products.brand_name}
                    </span>
                  )}
                  {sku && (
                    <span className="text-[10px] text-foreground-muted font-mono">
                      SKU: {sku}
                      <CopySku sku={sku} className="ml-1" />
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {item.variant && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700">
                      {item.variant.variant_name}
                    </span>
                  )}
                  {item.sub_variant && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-secondary border border-border-default">
                      {item.sub_variant.sub_variant_name}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground-secondary mt-1">
                  ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ×{' '}
                  {isFractional ? (
                    <>
                      {Number(Number(item.quantity).toFixed(6)).toString()}
                      {item.buy_unit && item.buy_unit !== 'unit' ? (
                        <>
                          {' '}
                          <UnitLabel label={item.buy_unit} />
                        </>
                      ) : (
                        ''
                      )}
                    </>
                  ) : (
                    effectiveQty
                  )}
                  {showMrp && (
                    <>
                      {' '}
                      <span className="line-through text-foreground-muted">
                        ₹
                        {Number(mrp).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>{' '}
                      <span className="text-accent-600 dark:text-accent-400 font-semibold">
                        {discountPct}% off
                      </span>
                    </>
                  )}
                </p>
                <p className="text-sm font-semibold text-foreground mt-1">
                  ₹
                  {itemTotal.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

/** The delivery address chosen on the review step, with Change back to it. */
export function DeliveryAddress({ c }: P) {
  const { address } = c
  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-foreground">Delivery Address</h2>
        <Link
          href="/checkout/review"
          className="text-accent-600 dark:text-accent-400 hover:text-accent-700 text-sm font-medium"
        >
          Change
        </Link>
      </div>
      <div className="bg-surface p-4 rounded-lg">
        <p className="font-semibold text-foreground">{address.full_name}</p>
        <p className="text-foreground-secondary mt-2">{address.address_line1}</p>
        {address.address_line2 && <p className="text-foreground-secondary">{address.address_line2}</p>}
        {address.landmark && (
          <p className="text-foreground-secondary text-sm">Landmark: {address.landmark}</p>
        )}
        <p className="text-foreground-secondary">
          {address.city}, {address.state} {address.postal_code}
        </p>
        <p className="text-foreground-secondary mt-2">Phone: {address.phone}</p>
      </div>
    </>
  )
}

export function OrderNotes({ c }: P) {
  const { notes, setNotes } = c
  return (
    <>
      <h2 className="text-xl font-bold text-foreground mb-4">Order Notes (Optional)</h2>
      <textarea
        rows={4}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
        placeholder="Any special instructions or requests..."
      />
    </>
  )
}

/** The payment choices (UPI, Razorpay, COD as the store and the order allow) and why none may be possible. */
export function PaymentMethod({ c }: P) {
  const { finalTotal, upiEnabled, isRazorpayEnabled, codAvailable, paymentMethod, choosePayment, noPaymentMethod, serviceable } = c
  return (
    <>
      <h2 className="text-xl font-bold text-foreground mb-4">Payment Method</h2>
      <div className="space-y-3">
        <PaymentSections
          amountInr={finalTotal}
          upi={upiEnabled}
          razorpay={isRazorpayEnabled}
          cod={codAvailable}
          value={paymentMethod}
          onChange={choosePayment}
        />
        {noPaymentMethod && (
          <p className="text-sm text-red-600 dark:text-red-400">
            No payment method is available for this cart.
          </p>
        )}
        {!serviceable && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Delivery is not available to this pincode. Please use a different delivery address.
          </p>
        )}
      </div>
    </>
  )
}

export function TrustStrip() {
  return (
    <div className="mt-8 bg-surface-elevated rounded-lg border border-border-default p-4">
      <div className="grid gap-3" style={badgeColumns(2)}>
        <div className="flex items-center gap-3">
          <svg
            className="w-8 h-8 text-green-600 dark:text-green-400 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <div>
            <p className="text-xs font-semibold text-foreground">Secure Checkout</p>
            <p className="text-xs text-foreground-muted">256-bit SSL encryption</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <svg
            className="w-8 h-8 text-blue-600 dark:text-blue-400 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <div>
            <p className="text-xs font-semibold text-foreground">Easy Returns</p>
            <p className="text-xs text-foreground-muted">7-day return policy</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <svg
            className="w-8 h-8 text-accent-500 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <div>
            <p className="text-xs font-semibold text-foreground">Genuine Products</p>
            <p className="text-xs text-foreground-muted">100% authentic items</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <svg
            className="w-8 h-8 text-foreground-secondary flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
            />
          </svg>
          <div>
            <p className="text-xs font-semibold text-foreground">24×7 Support</p>
            <p className="text-xs text-foreground-muted">Always here to help</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Subtotal, GST, coupon, delivery, COD fee and the total. */
export function SummaryLines({ c }: P) {
  const { isBuyNow, cartCount, subtotal, gstEnabled, tax, couponCode, discountAmount, shippingCharge, paymentMethod, codFee, finalTotal } = c
  return (
    <div className="space-y-3 mb-6">
      <div className="flex justify-between text-foreground-secondary">
        <span>Subtotal{!isBuyNow ? ` (${cartCount} items)` : ''}</span>
        <span>
          ₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      {!isBuyNow && gstEnabled && (
        <div className="flex justify-between text-foreground-muted text-sm">
          <span>Incl. GST</span>
          <span>
            ₹{tax.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
      {couponCode && discountAmount > 0 && (
        <div className="flex justify-between text-green-600 dark:text-green-400 text-sm font-medium">
          <span>Coupon ({couponCode})</span>
          <span>
            −₹
            {discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
      {shippingCharge != null && (
        <div className="flex justify-between text-foreground-secondary text-sm">
          <span>Delivery</span>
          <span>
            {shippingCharge === 0
              ? 'Free'
              : `₹${shippingCharge.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
      )}
      {paymentMethod === 'cod' && codFee > 0 && (
        <div className="flex justify-between text-foreground-secondary text-sm">
          <span>COD handling fee</span>
          <span>
            ₹{codFee.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
      <div className="border-t border-border-default pt-3">
        <div className="flex justify-between text-lg font-bold text-foreground">
          <span>Total</span>
          <span>
            ₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <p className="text-xs text-foreground-muted mt-1">Price inclusive of all taxes</p>
      </div>
    </div>
  )
}

export function StoreContact({ c }: P) {
  const { storeIdentity } = c
  return (
    <div className="border-t border-border-default pt-6 mb-6">
      <h3 className="font-semibold text-foreground mb-4">Contact Us</h3>
      <div className="space-y-3 text-sm">
        {storeIdentity.phone && (
          <a
            href={`tel:${storeIdentity.phone.replace(/[^+\d]/g, '')}`}
            className="flex items-center gap-3 text-foreground-secondary hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
          >
            <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            {storeIdentity.phone}
          </a>
        )}
        {storeIdentity.email && (
          <a
            href={`mailto:${storeIdentity.email}`}
            className="flex items-center gap-3 text-foreground-secondary hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
          >
            <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            {storeIdentity.email}
          </a>
        )}
        {!storeIdentity.phone && !storeIdentity.email && (
          <p className="text-foreground-muted">Contact details coming soon.</p>
        )}
      </div>
    </div>
  )
}

/** The place-order / pay button, or the notice when no payment method is available. */
export function PlaceOrderButton({ c }: P) {
  const { noPaymentMethod, submitDisabled, isSubmitting, isOnlinePay, finalTotal, paymentMethod } = c
  return (
    noPaymentMethod ? (
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
        We are unable to accept orders right now due to a technical issue. Please try again later or contact
        support.
      </div>
    ) : (
      <button
        id="checkout-summary-cta"
        type="submit"
        disabled={submitDisabled}
        className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center justify-center"
      >
        {isSubmitting ? (
          <>
            <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
            {isOnlinePay ? 'Processing...' : 'Placing Order...'}
          </>
        ) : isOnlinePay ? (
          <>
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            Pay ₹
            {finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </>
        ) : paymentMethod === 'cod' ? (
          <>
            Place Order — Pay on Delivery
            <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </>
        ) : (
          <>
            Place Order
            <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </>
        )}
      </button>
    )
  )
}

export function BackToReview() {
  return (
    <Link
      href="/checkout/review"
      className="block w-full text-center text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium mt-4"
    >
      ← Back to Review
    </Link>
  )
}

/** Phones: the bottom bar with the total and the submit button, while the summary's own button is off screen. */
export function CheckoutMobileBar({ c }: P) {
  const { noPaymentMethod, paymentMethod, finalTotal, submitDisabled, isSubmitting, isOnlinePay } = c
  if (noPaymentMethod) return null
  return (
    <MobileCheckoutBar
      watchId="checkout-summary-cta"
      label={paymentMethod === 'cod' ? 'Total · Pay on delivery' : 'Total'}
      amount={`₹${finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
    >
      <button
        type="submit"
        disabled={submitDisabled}
        className="shrink-0 min-h-[44px] px-5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Placing…' : isOnlinePay ? 'Pay now' : 'Place order'}
      </button>
    </MobileCheckoutBar>
  )
}

export function CheckoutUpiDialog({ c }: P) {
  const { upi, setIsSubmitting } = c
  return (
    <UpiManualDialog
      manual={upi.manual}
      busy={upi.busy}
      error={upi.error}
      onConfirm={upi.confirmUtr}
      onClose={() => {
        upi.dismissManual()
        setIsSubmitting(false)
      }}
    />
  )
}

'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import CopySku from '@/components/ui/CopySku'
import CouponNudge from '@/components/visitor/cart/CouponNudge'
import YourCoupons from '@/components/visitor/cart/YourCoupons'
import { isDigitalLine } from '@/components/visitor/cart/digital-lines'
import MobileCheckoutBar from '@/components/visitor/cart/MobileCheckoutBar'
import type { CartLine, CartParts } from './context'

// The cart's markup, cut from the old CartClient into pieces the built-in cart and the AI parts both place.

export const SUMMARY_CTA_ID = 'cart-summary-cta'
const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Render unit labels with proper superscripts: "ft2" → "ft²", "m2" → "m²"
export function UnitLabel({ label }: { label: string }) {
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

const cartIcon =
  'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'
const imageIcon =
  'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'

/** The whole page when there is nothing in the cart or saved for later. */
export function CartEmptyPage({ couponNotice }: { couponNotice?: ReactNode }) {
  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-md mx-auto text-center">
        {couponNotice}
        <svg aria-hidden="true" className="w-24 h-24 mx-auto text-foreground-muted mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d={cartIcon} />
        </svg>
        <h2 className="text-2xl font-bold text-foreground mb-2">Your cart is empty</h2>
        <p className="text-foreground-secondary mb-6">Start shopping to add items to your cart</p>
        <Link
          href="/products"
          className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
        >
          Browse Products
        </Link>
      </div>
    </div>
  )
}

/** In place of the lines when everything is saved for later. */
export function CartLinesEmptyBox() {
  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-8 text-center">
      <svg aria-hidden="true" className="w-16 h-16 mx-auto text-foreground-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d={cartIcon} />
      </svg>
      <p className="text-foreground-secondary mb-4">Your cart is empty.</p>
      <p className="text-sm text-foreground-muted">
        Move an item from below or{' '}
        <Link href="/products" className="text-accent-600 hover:text-accent-700 font-medium">
          browse products
        </Link>
        .
      </p>
    </div>
  )
}

/** A line's prices and quantity rules, as the cart has always worked them out. */
export function lineInfo(item: CartLine, updatingItems: Set<string>) {
  const primaryImage = item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
  const isCustomQty = !!(item.cart_item_unit?.dimension && item.cart_item_unit.dimension !== 'count')
  const unitFactor = !isCustomQty && item.cart_item_unit?.factor ? Number(item.cart_item_unit.factor) : 1
  const price = isCustomQty
    ? item.price_at_addition
    : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price) * unitFactor
  const mrp = item.sub_variant?.mrp ?? item.variant?.mrp ?? item.products.mrp ?? null
  const isOutOfStock =
    (item.sub_variant?.stock_status ?? item.variant?.stock_status ?? item.products.stock_status) === 'Out of Stock'
  const isInactive = item.products?.is_active === false
  const itemTotal = isCustomQty ? item.price_at_addition * Number(item.quantity) : price * Math.round(Number(item.quantity))
  const isUpdating = updatingItems.has(item.id)
  const showMrp = !isCustomQty && mrp !== null && Number(mrp) * unitFactor > Number(price)
  const discountPct = showMrp ? Math.round(((Number(mrp) * unitFactor - Number(price)) / (Number(mrp) * unitFactor)) * 100) : 0
  const sku = item.sub_variant?.sku || item.variant?.sku || item.products.sku
  const unitLabel = (item.cart_item_unit?.display_label ?? item.buy_unit) || ''
  const showUnitLabel = !!item.buy_unit && item.buy_unit !== 'unit'
  const qtyMin = isCustomQty ? (item.cart_item_unit?.min_qty ?? 0.001) : (item.cart_item_unit?.min_qty ?? 1)
  const qtyMax = isDigitalLine(item as any) ? 1 : (item.cart_item_unit?.max_qty ?? undefined)
  const qtyStep = isCustomQty ? (item.cart_item_unit?.qty_step ?? 0.001) : (item.cart_item_unit?.qty_step ?? 1)
  return {
    primaryImage,
    isCustomQty,
    unitFactor,
    price,
    mrp,
    isOutOfStock,
    isInactive,
    itemTotal,
    isUpdating,
    showMrp,
    discountPct,
    sku,
    unitLabel,
    showUnitLabel,
    qtyMin,
    qtyMax,
    qtyStep,
  }
}
type LineInfo = ReturnType<typeof lineInfo>

function LineImage({ item, info, size = 'w-24 h-24', icon = 'w-12 h-12' }: { item: CartLine; info: LineInfo; size?: string; icon?: string }) {
  return (
    <div className={`${size} bg-surface-elevated rounded-lg overflow-hidden border border-border-default`}>
      {info.primaryImage ? (
        <img
          src={info.primaryImage.thumbnail_url || info.primaryImage.image_url}
          alt={item.products.name}
          className="w-full h-full object-cover rounded-lg"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg aria-hidden="true" className={`${icon} text-foreground-muted`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d={imageIcon} />
          </svg>
        </div>
      )}
    </div>
  )
}

function VariantChips({ item, className = 'flex flex-wrap gap-1 mt-1' }: { item: CartLine; className?: string }) {
  return (
    <div className={className}>
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
  )
}

function LinePrice({ item, info }: { item: CartLine; info: LineInfo }) {
  const { isCustomQty, unitLabel, showUnitLabel, unitFactor, showMrp, mrp, discountPct, price } = info
  return (
    <div className="mt-2 flex items-center gap-3 flex-wrap">
      <span className="text-lg font-bold text-primary-600 dark:text-primary-400">
        ₹{money(price)}
        {isCustomQty ? (
          <>
            /&thinsp;
            <UnitLabel label={unitLabel || item.buy_unit || ''} />
          </>
        ) : showUnitLabel ? (
          <>
            /&thinsp;
            <UnitLabel label={unitLabel} />
          </>
        ) : (
          ''
        )}
      </span>
      {!isCustomQty && unitFactor > 1 && (
        <span className="text-xs text-foreground-muted">
          ₹{money(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)}
          /pc
        </span>
      )}
      {showMrp && (
        <>
          <span className="text-sm text-foreground-muted line-through">₹{money(Number(mrp) * unitFactor)}</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400">
            {discountPct}% off
          </span>
        </>
      )}
    </div>
  )
}

/** The quantity control for a line: fixed for digital, free entry for measured units, a stepper otherwise. */
function LineQuantity({ item, info, c }: { item: CartLine; info: LineInfo; c: CartParts }) {
  const { isCustomQty, unitLabel, isUpdating, qtyMin, qtyMax, qtyStep } = info
  if (isDigitalLine(item as any)) return <span className="text-sm text-foreground-secondary">Qty 1 · Digital</span>
  if (isCustomQty)
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={qtyMin}
          max={qtyMax}
          step={qtyStep}
          defaultValue={Number(Number(item.quantity).toFixed(6)).toString()}
          onBlur={e => {
            const val = parseFloat(e.target.value)
            let safe = !isNaN(val) ? val : qtyMin
            safe = Math.round(safe / qtyStep) * qtyStep
            if (safe < qtyMin) safe = qtyMin
            if (qtyMax !== undefined && safe > qtyMax) safe = qtyMax
            safe = parseFloat(safe.toFixed(6))
            e.target.value = String(safe)
            if (safe !== Number(item.quantity)) {
              c.handleQuantityChange(item.id, safe)
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          disabled={isUpdating}
          className="w-24 px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground font-semibold text-sm text-center focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 disabled:opacity-50"
        />
        <span className="text-sm text-foreground-muted">
          <UnitLabel label={unitLabel || item.buy_unit || ''} />
        </span>
        <span className="text-xs text-foreground-muted">
          @ ₹{money(Number(item.price_at_addition))}
          /&thinsp;
          <UnitLabel label={unitLabel || item.buy_unit || ''} />
        </span>
      </div>
    )
  return (
    <div className="flex items-center border border-border-secondary rounded-lg">
      <button
        onClick={() => c.handleQuantityChange(item.id, Number(item.quantity) - qtyStep)}
        disabled={isUpdating || Number(item.quantity) <= qtyMin}
        aria-label={`Decrease quantity for ${item.products.name}`}
        className="px-3 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
        </svg>
      </button>
      {isUpdating ? (
        <span
          role="status"
          aria-label="Loading"
          className="px-4 py-2 border-x border-border-secondary min-w-[60px] text-center flex items-center justify-center"
        >
          <div className="animate-spin w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full"></div>
        </span>
      ) : (
        <input
          type="number"
          min={qtyMin}
          max={qtyMax}
          step={qtyStep}
          defaultValue={Math.round(Number(item.quantity))}
          onBlur={e => {
            const val = parseInt(e.target.value, 10)
            let safe = !isNaN(val) ? val : qtyMin
            safe = Math.round(safe / qtyStep) * qtyStep
            if (safe < qtyMin) safe = qtyMin
            if (qtyMax !== undefined && safe > qtyMax) safe = qtyMax
            e.target.value = String(safe)
            if (safe !== Math.round(Number(item.quantity))) {
              c.handleQuantityChange(item.id, safe)
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="w-16 px-1 py-2 border-x border-border-secondary text-center font-semibold bg-surface text-foreground focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      )}
      <button
        onClick={() => c.handleQuantityChange(item.id, Number(item.quantity) + qtyStep)}
        disabled={isUpdating || (qtyMax !== undefined && Number(item.quantity) >= qtyMax)}
        aria-label={`Increase quantity for ${item.products.name}`}
        className="px-3 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  )
}

function QtyHint({ info }: { info: LineInfo }) {
  const { isCustomQty, qtyMin, qtyMax, qtyStep, unitLabel } = info
  const hintParts: string[] = []
  if (qtyMin > (isCustomQty ? 0 : 1)) hintParts.push(`Min: ${qtyMin}`)
  if (qtyMax != null) hintParts.push(`Max: ${qtyMax}`)
  const defaultStep = isCustomQty ? 0.001 : 1
  if (qtyStep !== defaultStep) hintParts.push(`Step: ${qtyStep}`)
  if (hintParts.length === 0) return null
  return (
    <p className="text-xs text-foreground-muted mt-1">
      {hintParts.join(' · ')}
      {unitLabel ? ` ${unitLabel}` : ''}
    </p>
  )
}

/** One cart line as a row: picture, name and chips, price, quantity, save/remove and the line total. */
export function CartLineRow({ item, c }: { item: CartLine; c: CartParts }) {
  const info = lineInfo(item, c.updatingItems)
  const { isCustomQty, showUnitLabel, unitLabel, sku, isInactive, itemTotal } = info
  return (
    <div className="p-4 sm:p-6 border-b border-border-default last:border-b-0">
      <div className="flex gap-4 sm:gap-6">
        {/* Product Image */}
        <Link href={`/products/${item.products.slug}`} className="flex-shrink-0">
          <LineImage item={item} info={info} />
        </Link>

        {/* Product Details */}
        <div className="flex-1">
          <Link
            href={`/products/${item.products.slug}`}
            className="text-base sm:text-lg font-semibold text-foreground hover:text-accent-600 transition-colors"
          >
            {item.products.name}
          </Link>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {item.products.brand_name && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-secondary text-foreground-secondary border border-border-default">
                {item.products.brand_name}
              </span>
            )}
            {sku && (
              <span className="text-xs text-foreground-muted font-mono">
                SKU: {sku}
                <CopySku sku={sku} className="ml-1" />
              </span>
            )}
            {isInactive && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                Unavailable
              </span>
            )}
            <ProductWarningBadges
              fragile={item.products?.fragile}
              hazardous={item.products?.hazardous}
              flammable={item.products?.flammable}
              size="xs"
            />
          </div>
          <VariantChips item={item} />

          <LinePrice item={item} info={info} />

          {/* Quantity Controls */}
          <div className="mt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <LineQuantity item={item} info={info} c={c} />

              {!isCustomQty && showUnitLabel && (
                <span className="text-sm text-foreground-muted">
                  <UnitLabel label={unitLabel} />
                </span>
              )}

              <button
                onClick={() => c.handleSaveForLater(item.id)}
                aria-label={`Save ${item.products.name} for later`}
                className="text-foreground-secondary hover:text-accent-600 text-sm font-medium transition-colors"
              >
                Save for later
              </button>

              <button
                onClick={() => c.handleRemove(item.id)}
                aria-label={`Remove ${item.products.name} from cart`}
                className="text-red-600 hover:text-red-700 text-sm font-medium transition-colors"
              >
                Remove
              </button>
            </div>
            <QtyHint info={info} />
          </div>

          {/* Item Total */}
          <div className="mt-4">
            <span className="text-sm text-foreground-secondary">Subtotal: </span>
            <span className="text-lg font-bold text-foreground">₹{money(itemTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** One cart line as a card (the AI's "cards" layout): the same controls, stacked. */
export function CartLineCard({ item, c }: { item: CartLine; c: CartParts }) {
  const info = lineInfo(item, c.updatingItems)
  return (
    <div className="flex flex-col bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4">
      <Link href={`/products/${item.products.slug}`} className="block">
        <LineImage item={item} info={info} size="w-full aspect-square" icon="w-12 h-12" />
      </Link>
      <Link
        href={`/products/${item.products.slug}`}
        className="mt-3 text-base font-semibold text-foreground hover:text-accent-600 transition-colors line-clamp-2"
      >
        {item.products.name}
      </Link>
      {info.isInactive && (
        <span className="mt-1 self-start text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
          Unavailable
        </span>
      )}
      <VariantChips item={item} />
      <LinePrice item={item} info={info} />
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <LineQuantity item={item} info={info} c={c} />
      </div>
      <QtyHint info={info} />
      <div className="mt-auto pt-3 flex items-center justify-between gap-3">
        <span className="text-base font-bold text-foreground">₹{money(info.itemTotal)}</span>
        <span className="flex gap-3">
          <button
            onClick={() => c.handleSaveForLater(item.id)}
            aria-label={`Save ${item.products.name} for later`}
            className="text-foreground-secondary hover:text-accent-600 text-sm font-medium transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => c.handleRemove(item.id)}
            aria-label={`Remove ${item.products.name} from cart`}
            className="text-red-600 hover:text-red-700 text-sm font-medium transition-colors"
          >
            Remove
          </button>
        </span>
      </div>
    </div>
  )
}

export function CartLineList({ c }: { c: CartParts }) {
  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      {c.cartItems.map(item => (
        <CartLineRow key={item.id} item={item} c={c} />
      ))}
    </div>
  )
}

/** The saved-for-later list under the lines. */
export function SavedForLater({ c }: { c: CartParts }) {
  const { savedItems, updatingItems } = c
  if (savedItems.length === 0) return null
  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default mt-6 animate-fade-in-up">
      <div className="p-4 sm:p-6 border-b border-border-default flex items-center justify-between">
        <h2 className="font-semibold text-foreground">
          Saved for later <span className="text-foreground-muted font-normal">({savedItems.length})</span>
        </h2>
      </div>
      <div className="divide-y divide-border-default">
        {savedItems.map(item => {
          const primaryImage = item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
          const isCustomQty = !!(item.cart_item_unit?.dimension && item.cart_item_unit.dimension !== 'count')
          const price = isCustomQty ? item.price_at_addition : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
          const sku = item.sub_variant?.sku || item.variant?.sku || item.products.sku
          const isUpdating = updatingItems.has(item.id)
          return (
            <div key={item.id} className="p-4 sm:p-6 flex gap-4">
              <Link href={`/products/${item.products.slug}`} className="shrink-0">
                <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden border border-border-default">
                  {primaryImage ? (
                    <img
                      src={primaryImage.thumbnail_url || primaryImage.image_url}
                      alt={item.products.name}
                      className="w-full h-full object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg aria-hidden="true" className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d={imageIcon} />
                      </svg>
                    </div>
                  )}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/products/${item.products.slug}`}
                  className="text-base font-semibold text-foreground hover:text-accent-600 transition-colors line-clamp-1"
                >
                  {item.products.name}
                </Link>
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
                <VariantChips item={item} className="flex flex-wrap gap-1 mt-0.5" />
                <p className="text-sm font-bold text-primary-600 dark:text-primary-400 mt-1">
                  ₹{money(Number(price))}
                  {isCustomQty ? (
                    <>
                      /&thinsp;
                      <UnitLabel label={item.cart_item_unit?.display_label ?? item.buy_unit ?? ''} />
                    </>
                  ) : (
                    ''
                  )}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => c.handleMoveToCart(item.id)}
                    disabled={isUpdating}
                    className="text-sm font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 transition-colors disabled:opacity-50"
                  >
                    Move to cart
                  </button>
                  <button
                    onClick={() => c.handleRemove(item.id)}
                    disabled={isUpdating}
                    aria-label={`Remove ${item.products.name} from cart`}
                    className="text-sm font-medium text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The coupon field, or the applied coupon with Remove; offers and the customer's coupons under the field. */
export function CouponInput({ c }: { c: CartParts }) {
  const { appliedCoupon, couponCode, couponLoading, couponError, total, user } = c
  return appliedCoupon ? (
    <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
      <div>
        <p className="text-sm font-semibold text-green-700 dark:text-green-400">{appliedCoupon.code} applied</p>
        {appliedCoupon.description && <p className="text-xs text-green-600 dark:text-green-500">{appliedCoupon.description}</p>}
      </div>
      <button onClick={c.handleRemoveCoupon} className="text-xs text-red-500 hover:text-red-600 font-medium ml-3">
        Remove
      </button>
    </div>
  ) : (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={couponCode}
          onChange={e => {
            c.setCouponCode(e.target.value.toUpperCase())
            c.setCouponError('')
          }}
          onKeyDown={e => e.key === 'Enter' && c.handleApplyCoupon()}
          placeholder="Coupon code"
          className="flex-1 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder-foreground-muted focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
        />
        <button
          onClick={() => c.handleApplyCoupon()}
          disabled={couponLoading || !couponCode.trim()}
          className="px-4 py-2 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {couponLoading ? '...' : 'Apply'}
        </button>
      </div>
      {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
      <CouponNudge subtotal={total} signedIn={!!user} applying={couponLoading} onApply={c.handleApplyCoupon} />
      {user && <YourCoupons subtotal={total} applying={couponLoading} onApply={c.handleApplyCoupon} />}
    </div>
  )
}

/** Subtotal, GST, the coupon and the total. */
export function SummaryTotals({ c }: { c: CartParts }) {
  const { cartCount, total, gstEnabled, tax, discount, appliedCoupon, finalTotal } = c
  return (
    <div className="space-y-3 mb-6">
      <div className="flex justify-between text-foreground-secondary">
        <span>Subtotal ({cartCount} items)</span>
        <span>₹{money(total)}</span>
      </div>
      {gstEnabled && (
        <div className="flex justify-between text-foreground-muted text-sm">
          <span>Incl. GST</span>
          <span>₹{money(tax)}</span>
        </div>
      )}
      {discount > 0 && (
        <div className="flex justify-between text-green-600 dark:text-green-400 text-sm font-medium">
          <span>Coupon ({appliedCoupon!.code})</span>
          <span>-₹{money(discount)}</span>
        </div>
      )}
      <div className="border-t border-border-default pt-3">
        <div className="flex justify-between text-lg font-bold text-foreground">
          <span>Total</span>
          <span>₹{money(finalTotal)}</span>
        </div>
        {discount > 0 && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
            You save ₹{money(discount)} with this coupon
          </p>
        )}
        {gstEnabled && <p className="text-xs text-foreground-muted mt-1">Price inclusive of all taxes</p>}
      </div>
    </div>
  )
}

const arrow = (
  <svg aria-hidden="true" className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
)

/** Proceed to checkout (signed in) or sign in to check out. `label` replaces the default wording only. */
export function CheckoutCta({ c, label, className }: { c: CartParts; label?: string; className?: string }) {
  const { user, proceedingToCheckout, cartCount, hasInactiveItems } = c
  const btn =
    className ??
    'w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center'
  return (
    <div id={SUMMARY_CTA_ID}>
      {user ? (
        <button type="button" onClick={c.proceedToCheckout} disabled={proceedingToCheckout || cartCount === 0 || hasInactiveItems} className={btn}>
          {proceedingToCheckout ? 'Starting…' : hasInactiveItems ? 'Remove unavailable items to checkout' : (label ?? 'Proceed to Checkout')}
          {arrow}
        </button>
      ) : (
        <div className="space-y-3">
          <Link href="/login?redirect=/checkout" className={className ?? 'w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center'}>
            Login to Checkout
            {arrow}
          </Link>
          <p className="text-sm text-foreground-secondary text-center">
            New customer?{' '}
            <Link href="/signup" className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium">
              Create an account
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}

export function ContinueShopping() {
  return (
    <Link href="/products" className="block w-full text-center text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium mt-4">
      Continue Shopping
    </Link>
  )
}

/** Phones: the bottom bar with the total and checkout, while the summary's own button is off screen. */
export function CartMobileBar({ c }: { c: CartParts }) {
  const { cartItems, hasInactiveItems, cartCount, finalTotal, user, proceedingToCheckout } = c
  if (cartItems.length === 0) return null
  return (
    <MobileCheckoutBar
      watchId={SUMMARY_CTA_ID}
      label={
        hasInactiveItems ? (
          <span className="text-red-600 dark:text-red-400">Remove unavailable items</span>
        ) : (
          `Total (${cartCount} ${cartCount === 1 ? 'item' : 'items'})`
        )
      }
      amount={`₹${money(finalTotal)}`}
    >
      {user ? (
        <button
          type="button"
          onClick={c.proceedToCheckout}
          disabled={proceedingToCheckout || cartCount === 0 || hasInactiveItems}
          className="shrink-0 min-h-[44px] px-5 bg-accent-500 hover:bg-accent-600 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors"
        >
          {proceedingToCheckout ? 'Starting…' : 'Checkout'}
        </button>
      ) : (
        <Link
          href="/login?redirect=/checkout"
          className="shrink-0 min-h-[44px] px-5 inline-flex items-center bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          Login to checkout
        </Link>
      )}
    </MobileCheckoutBar>
  )
}

'use client'

import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import FeaturedForYou from '@/components/visitor/FeaturedForYou'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import CopySku from '@/components/ui/CopySku'
import CartInsightPanel from '@/components/on-device/CartInsightPanel'
import FreeShippingProgress from '@/components/visitor/cart/FreeShippingProgress'
import CartUpsellRow from '@/components/visitor/cart/CartUpsellRow'
import CouponNudge from '@/components/visitor/cart/CouponNudge'

interface AppliedCoupon {
  couponId: string
  code: string
  description: string | null
  discountAmount: number
}

// Render unit labels with proper superscripts: "ft2" → "ft²", "m2" → "m²"
function UnitLabel({ label }: { label: string }) {
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

export default function CartPage() {
  const {
    cartItems,
    savedItems,
    cartCount,
    isLoading,
    removeFromCart,
    updateQuantity,
    saveForLater,
    moveToCart,
    getCartTotal,
    getCartTax,
  } = useCart()
  const gstEnabled = useStoreConfig().flags.gstEnabled
  const hasInactiveItems = cartItems.some((item: any) => item.products?.is_active === false)
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set())
  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState('')
  const [proceedingToCheckout, setProceedingToCheckout] = useState(false)
  const router = useRouter()

  async function proceedToCheckout() {
    setProceedingToCheckout(true)
    try {
      const res = await fetch('/api/checkout/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'cart' }),
      })
      const data = await res.json()
      if (!res.ok || !data.intent) {
        showToast(data?.error || 'Failed to start checkout', 'error')
        setProceedingToCheckout(false)
        return
      }
      const params = new URLSearchParams({ intent: data.intent })
      if (appliedCoupon) params.set('couponCode', appliedCoupon.code)
      router.push(`/checkout/review?${params.toString()}`)
    } catch {
      showToast('Could not reach the server. Please try again.', 'error')
      setProceedingToCheckout(false)
    }
  }

  const handleQuantityChange = async (cartItemId: string, newQuantity: number) => {
    if (newQuantity < 1) return

    setUpdatingItems(prev => new Set(prev).add(cartItemId))
    try {
      await updateQuantity(cartItemId, newQuantity)
    } catch (error) {
      showToast('Failed to update quantity', 'error')
    } finally {
      setUpdatingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(cartItemId)
        return newSet
      })
    }
  }

  const handleRemove = async (cartItemId: string) => {
    const ok = await confirm({
      title: 'Remove from Cart',
      message: 'Are you sure you want to remove this item from your cart?',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await removeFromCart(cartItemId)
      showToast('Item removed from cart', 'success')
    } catch (error) {
      showToast('Failed to remove item', 'error')
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-elevated rounded-lg border border-border-default p-4 flex gap-4"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="w-20 h-20 bg-surface-secondary rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-surface-secondary rounded w-3/4" />
                <div className="h-3 bg-surface-secondary rounded w-1/2" />
                <div className="h-4 bg-surface-secondary rounded w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (cartCount === 0 && savedItems.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto text-center">
          <svg
            aria-hidden="true"
            className="w-24 h-24 mx-auto text-foreground-muted mb-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
            />
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

  const total = getCartTotal()
  const tax = getCartTax()
  const discount = appliedCoupon?.discountAmount ?? 0
  const finalTotal = Math.max(0, total - discount)

  const handleApplyCoupon = async (codeArg?: string) => {
    const code = (codeArg ?? couponCode).trim()
    if (!code) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const res = await fetch('/api/coupons/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code, subtotal: total }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCouponError(data.error || 'Invalid coupon')
      } else {
        setAppliedCoupon({
          couponId: data.couponId,
          code: data.code,
          description: data.description,
          discountAmount: data.discountAmount,
        })
        setCouponCode('')
        showToast(
          `Coupon "${data.code}" applied — saving ₹${data.discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          'success'
        )
      }
    } catch {
      setCouponError('Failed to apply coupon')
    } finally {
      setCouponLoading(false)
    }
  }

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null)
    setCouponError('')
  }

  return (
    <div className="bg-surface min-h-screen py-4 sm:py-6 lg:py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-foreground mb-4 sm:mb-6 lg:mb-8">Shopping Cart</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            <FreeShippingProgress subtotal={total} />
            {cartItems.length === 0 ? (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-8 text-center">
                <svg
                  aria-hidden="true"
                  className="w-16 h-16 mx-auto text-foreground-muted mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                  />
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
            ) : (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
                {cartItems.map(item => {
                  const primaryImage =
                    item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
                  const isCustomQty = !!(item.cart_item_unit?.dimension && item.cart_item_unit.dimension !== 'count')
                  const unitFactor =
                    !isCustomQty && item.cart_item_unit?.factor ? Number(item.cart_item_unit.factor) : 1
                  const price = isCustomQty
                    ? item.price_at_addition
                    : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price) * unitFactor
                  const mrp = item.sub_variant?.mrp ?? item.variant?.mrp ?? item.products.mrp ?? null
                  const isOutOfStock =
                    (item.sub_variant?.stock_status ?? item.variant?.stock_status ?? item.products.stock_status) ===
                    'Out of Stock'
                  const isInactive = item.products?.is_active === false
                  const itemTotal = isCustomQty
                    ? item.price_at_addition * Number(item.quantity)
                    : price * Math.round(Number(item.quantity))
                  const isUpdating = updatingItems.has(item.id)
                  const showMrp = !isCustomQty && mrp !== null && Number(mrp) * unitFactor > Number(price)
                  const discountPct = showMrp
                    ? Math.round(((Number(mrp) * unitFactor - Number(price)) / (Number(mrp) * unitFactor)) * 100)
                    : 0
                  const sku = item.sub_variant?.sku || item.variant?.sku || item.products.sku
                  const unitLabel = (item.cart_item_unit?.display_label ?? item.buy_unit) || ''
                  const showUnitLabel = !!item.buy_unit && item.buy_unit !== 'unit'
                  const qtyMin = isCustomQty
                    ? (item.cart_item_unit?.min_qty ?? 0.001)
                    : (item.cart_item_unit?.min_qty ?? 1)
                  const qtyMax = item.cart_item_unit?.max_qty ?? undefined
                  const qtyStep = isCustomQty
                    ? (item.cart_item_unit?.qty_step ?? 0.001)
                    : (item.cart_item_unit?.qty_step ?? 1)

                  return (
                    <div key={item.id} className="p-4 sm:p-6 border-b border-border-default last:border-b-0">
                      <div className="flex gap-4 sm:gap-6">
                        {/* Product Image */}
                        <Link href={`/products/${item.products.slug}`} className="flex-shrink-0">
                          <div className="w-24 h-24 bg-surface-elevated rounded-lg overflow-hidden border border-border-default">
                            {primaryImage ? (
                              <img
                                src={primaryImage.thumbnail_url || primaryImage.image_url}
                                alt={item.products.name}
                                className="w-full h-full object-cover rounded-lg"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg
                                  aria-hidden="true"
                                  className="w-12 h-12 text-foreground-muted"
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

                          <div className="mt-2 flex items-center gap-3 flex-wrap">
                            <span className="text-lg font-bold text-primary-600 dark:text-primary-400">
                              ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                                ₹
                                {(
                                  item.sub_variant?.price ??
                                  item.variant?.price ??
                                  item.products.base_price
                                ).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                /pc
                              </span>
                            )}
                            {showMrp && (
                              <>
                                <span className="text-sm text-foreground-muted line-through">
                                  ₹{(Number(mrp) * unitFactor).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </span>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400">
                                  {discountPct}% off
                                </span>
                              </>
                            )}
                          </div>

                          {/* Quantity Controls */}
                          <div className="mt-4">
                            <div className="flex items-center gap-3 flex-wrap">
                              {isCustomQty ? (
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
                                        handleQuantityChange(item.id, safe)
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
                                    @ ₹
                                    {Number(item.price_at_addition).toLocaleString('en-IN', {
                                      minimumFractionDigits: 2,
                                    })}
                                    /&thinsp;
                                    <UnitLabel label={unitLabel || item.buy_unit || ''} />
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center border border-border-secondary rounded-lg">
                                  <button
                                    onClick={() => handleQuantityChange(item.id, Number(item.quantity) - qtyStep)}
                                    disabled={isUpdating || Number(item.quantity) <= qtyMin}
                                    aria-label={`Decrease quantity for ${item.products.name}`}
                                    className="px-3 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    <svg
                                      aria-hidden="true"
                                      className="w-4 h-4"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
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
                                          handleQuantityChange(item.id, safe)
                                        }
                                      }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                      }}
                                      className="w-16 px-1 py-2 border-x border-border-secondary text-center font-semibold bg-surface text-foreground focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                  )}
                                  <button
                                    onClick={() => handleQuantityChange(item.id, Number(item.quantity) + qtyStep)}
                                    disabled={isUpdating || (qtyMax !== undefined && Number(item.quantity) >= qtyMax)}
                                    aria-label={`Increase quantity for ${item.products.name}`}
                                    className="px-3 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    <svg
                                      aria-hidden="true"
                                      className="w-4 h-4"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 4v16m8-8H4"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              )}

                              {!isCustomQty && showUnitLabel && (
                                <span className="text-sm text-foreground-muted">
                                  <UnitLabel label={unitLabel} />
                                </span>
                              )}

                              <button
                                onClick={async () => {
                                  try {
                                    await saveForLater(item.id)
                                    showToast('Saved for later', 'success')
                                  } catch {
                                    showToast('Failed to save', 'error')
                                  }
                                }}
                                aria-label={`Save ${item.products.name} for later`}
                                className="text-foreground-secondary hover:text-accent-600 text-sm font-medium transition-colors"
                              >
                                Save for later
                              </button>

                              <button
                                onClick={() => handleRemove(item.id)}
                                aria-label={`Remove ${item.products.name} from cart`}
                                className="text-red-600 hover:text-red-700 text-sm font-medium transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                            {(() => {
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
                            })()}
                          </div>

                          {/* Item Total */}
                          <div className="mt-4">
                            <span className="text-sm text-foreground-secondary">Subtotal: </span>
                            <span className="text-lg font-bold text-foreground">
                              ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {savedItems.length > 0 && (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default mt-6 animate-fade-in-up">
                <div className="p-4 sm:p-6 border-b border-border-default flex items-center justify-between">
                  <h2 className="font-semibold text-foreground">
                    Saved for later <span className="text-foreground-muted font-normal">({savedItems.length})</span>
                  </h2>
                </div>
                <div className="divide-y divide-border-default">
                  {savedItems.map(item => {
                    const primaryImage =
                      item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
                    const isCustomQty = !!(item.cart_item_unit?.dimension && item.cart_item_unit.dimension !== 'count')
                    const price = isCustomQty
                      ? item.price_at_addition
                      : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
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
                                <svg
                                  aria-hidden="true"
                                  className="w-8 h-8 text-foreground-muted"
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
                          <div className="flex flex-wrap gap-1 mt-0.5">
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
                          <p className="text-sm font-bold text-primary-600 dark:text-primary-400 mt-1">
                            ₹{Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                              onClick={async () => {
                                setUpdatingItems(prev => new Set(prev).add(item.id))
                                try {
                                  await moveToCart(item.id)
                                  showToast('Moved to cart', 'success')
                                } catch {
                                  showToast('Failed to move', 'error')
                                } finally {
                                  setUpdatingItems(prev => {
                                    const next = new Set(prev)
                                    next.delete(item.id)
                                    return next
                                  })
                                }
                              }}
                              disabled={isUpdating}
                              className="text-sm font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 transition-colors disabled:opacity-50"
                            >
                              Move to cart
                            </button>
                            <button
                              onClick={() => handleRemove(item.id)}
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
            )}

            <CartInsightPanel
              items={cartItems.map(i => ({
                name: i.products?.name || '',
                brand: i.products?.brand_name || null,
                category: null,
                qty: Number(i.quantity),
              }))}
            />

            <CartUpsellRow
              cartProductIds={cartItems.map(i => i.product_id)}
              savedProductIds={savedItems.map(i => i.product_id)}
            />

            <FeaturedForYou compact limit={4} />
          </div>

          {/* Order Summary */}
          {cartItems.length > 0 && (
            <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-24">
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
                <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>

                {/* Coupon Input */}
                <div className="mb-5">
                  {appliedCoupon ? (
                    <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                          {appliedCoupon.code} applied
                        </p>
                        {appliedCoupon.description && (
                          <p className="text-xs text-green-600 dark:text-green-500">{appliedCoupon.description}</p>
                        )}
                      </div>
                      <button
                        onClick={handleRemoveCoupon}
                        className="text-xs text-red-500 hover:text-red-600 font-medium ml-3"
                      >
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
                            setCouponCode(e.target.value.toUpperCase())
                            setCouponError('')
                          }}
                          onKeyDown={e => e.key === 'Enter' && handleApplyCoupon()}
                          placeholder="Coupon code"
                          className="flex-1 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder-foreground-muted focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                        />
                        <button
                          onClick={() => handleApplyCoupon()}
                          disabled={couponLoading || !couponCode.trim()}
                          className="px-4 py-2 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {couponLoading ? '...' : 'Apply'}
                        </button>
                      </div>
                      {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
                      <CouponNudge
                        subtotal={total}
                        signedIn={!!user}
                        applying={couponLoading}
                        onApply={handleApplyCoupon}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-foreground-secondary">
                    <span>Subtotal ({cartCount} items)</span>
                    <span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {gstEnabled && (
                    <div className="flex justify-between text-foreground-muted text-sm">
                      <span>Incl. GST</span>
                      <span>₹{tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400 text-sm font-medium">
                      <span>Coupon ({appliedCoupon!.code})</span>
                      <span>-₹{discount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="border-t border-border-default pt-3">
                    <div className="flex justify-between text-lg font-bold text-foreground">
                      <span>Total</span>
                      <span>₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    {discount > 0 && (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        You save ₹{discount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} with this coupon
                      </p>
                    )}
                    {gstEnabled && <p className="text-xs text-foreground-muted mt-1">Price inclusive of all taxes</p>}
                  </div>
                </div>

                {user ? (
                  <button
                    type="button"
                    onClick={proceedToCheckout}
                    disabled={proceedingToCheckout || cartCount === 0 || hasInactiveItems}
                    className="w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center"
                  >
                    {proceedingToCheckout
                      ? 'Starting…'
                      : hasInactiveItems
                        ? 'Remove unavailable items to checkout'
                        : 'Proceed to Checkout'}
                    <svg
                      aria-hidden="true"
                      className="w-5 h-5 ml-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <Link
                      href="/login?redirect=/checkout"
                      className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center"
                    >
                      Login to Checkout
                      <svg
                        aria-hidden="true"
                        className="w-5 h-5 ml-2"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                    <p className="text-sm text-foreground-secondary text-center">
                      New customer?{' '}
                      <Link
                        href="/signup"
                        className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium"
                      >
                        Create an account
                      </Link>
                    </p>
                  </div>
                )}

                <Link
                  href="/products"
                  className="block w-full text-center text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium mt-4"
                >
                  Continue Shopping
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

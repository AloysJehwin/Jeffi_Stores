'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'motion/react'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { round2 } from '@/lib/catalog/gst'
import { trackAddToCart } from '@/lib/client/analytics'
import QuantityInput from '@/components/shared/QuantityInput'
import InCartQtyHint from '@/components/shared/InCartQtyHint'
import { inCartQuantity, pickerQtyCap } from '@/lib/catalog/cart-unit-cap'
import { startBuyNow } from '@/lib/client/buy-now'
import { useProductLikeShare } from '@/components/visitor/useProductLikeShare'

interface VariantImage {
  id: string
  image_url: string
  thumbnail_url: string
  is_primary: boolean
}

interface SubVariant {
  id: string
  sub_variant_name: string
  sku?: string | null
  price: number | null
  mrp: number | null
  price_ex_gst: number | null
  stock_status: string
  is_active: boolean
}

interface Variant {
  id: string
  variant_name: string
  sku: string
  price: number | null
  mrp: number | null
  price_ex_gst: number | null
  stock_status: string
  pricing_type?: string
  unit?: string
  numeric_value?: number | null
  variant_type?: string | null
  sub_variant_type?: string | null
  sell_unit_id?: string | null
  variant_images?: VariantImage[]
  sub_variants?: SubVariant[]
}

interface ProductUnit {
  id: string
  variant_id: string | null
  sub_variant_id: string | null
  unit: string
  factor: number
  is_base: boolean
  is_purchase_default: boolean
  display_label: string | null
  dimension: string
  min_qty?: number | null
  max_qty?: number | null
  qty_step?: number | null
}

interface VariantsResponse {
  product_variants: Variant[]
  product_units: ProductUnit[]
  is_digital?: boolean
}

interface QuickAddPickerProps {
  productId: string
  productName: string
  slug: string
  onClose: () => void
  onStop: (e: React.MouseEvent) => void
  imageUrl?: string | null
  brandName?: string | null
  categoryName?: string | null
  displayPrice?: number
  mrp?: number | null
  discountPct?: number
  inStock?: boolean
  isDigital?: boolean
  portal?: 'storefront' | 'business'
  productHref?: string
}

const GENERIC_UNITS = new Set(['unit', 'units', 'pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'each'])

const ICON_BTN =
  'flex-shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-full border border-border-default bg-surface-secondary flex items-center justify-center text-foreground-muted transition-colors disabled:opacity-60'

/** Like (storefront only) + Share + Close for the quick-add popup header. */
export function QuickAddHeaderActions({
  productId,
  productName,
  slug,
  href,
  showWishlist,
  onClose,
  onStop,
}: {
  productId: string
  productName: string
  slug: string
  href: string
  showWishlist: boolean
  onClose: () => void
  onStop: (e: React.MouseEvent) => void
}) {
  const { isInWishlist, wishlistLoading, handleWishlist, handleShare } = useProductLikeShare({
    id: productId,
    slug,
    name: productName,
    href,
  })
  return (
    <div className="flex-shrink-0 flex items-center gap-1 sm:gap-1.5">
      {showWishlist && (
        <button
          type="button"
          onClick={handleWishlist}
          disabled={wishlistLoading}
          aria-label={isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          aria-pressed={isInWishlist}
          className={`${ICON_BTN} ${isInWishlist ? 'text-red-500 border-red-300' : 'hover:text-red-500 hover:border-red-300'}`}
        >
          <svg
            className="w-4 h-4"
            fill={isInWishlist ? 'currentColor' : 'none'}
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={handleShare}
        aria-label="Share product"
        className={`${ICON_BTN} hover:text-accent-500 hover:border-accent-400`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={e => {
          onStop(e)
          onClose()
        }}
        aria-label="Close"
        className="flex-shrink-0 w-11 h-11 -mr-2 sm:mr-0 sm:w-7 sm:h-7 rounded-full text-xl sm:text-base text-foreground-muted hover:text-foreground flex items-center justify-center"
      >
        &#215;
      </button>
    </div>
  )
}

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

export default function QuickAddPicker({
  productId,
  productName,
  slug,
  onClose,
  onStop,
  imageUrl,
  brandName,
  categoryName,
  displayPrice,
  mrp,
  discountPct,
  inStock,
  isDigital: isDigitalProp = false,
  portal = 'storefront',
  productHref,
}: QuickAddPickerProps) {
  const prefersReduced = useReducedMotion()
  const router = useRouter()
  const { addToCart, cartItems } = useCart()
  const { showToast } = useToast()
  const gstEnabled = useStoreConfig().flags.gstEnabled

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [variants, setVariants] = useState<Variant[]>([])
  const [productUnits, setProductUnits] = useState<ProductUnit[]>([])
  const [adding, setAdding] = useState(false)

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [selectedSubVariantId, setSelectedSubVariantId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [quantityRaw, setQuantityRaw] = useState('1')
  const [apiDigital, setApiDigital] = useState(false)
  const isDigital = isDigitalProp || apiDigital

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    fetch(`/api/products/slug/${encodeURIComponent(slug)}/variants`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((data: VariantsResponse) => {
        if (cancelled) return
        const vs = data.product_variants ?? []
        setVariants(vs)
        setProductUnits(data.product_units ?? [])
        setApiDigital(!!data.is_digital)
        const firstVariant = vs.find(v => v.stock_status !== 'Out of Stock') ?? vs[0] ?? null
        if (firstVariant) {
          setSelectedVariantId(firstVariant.id)
          const subs = firstVariant.sub_variants ?? []
          if (subs.length > 0) {
            const firstSub =
              subs.find(s => s.is_active && s.stock_status !== 'Out of Stock') ?? subs.find(s => s.is_active) ?? subs[0]
            setSelectedSubVariantId(firstSub?.id ?? null)
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const selectedVariant = variants.find(v => v.id === selectedVariantId) ?? null
  const subVariants = selectedVariant?.sub_variants ?? []
  const selectedSubVariant = subVariants.find(sv => sv.id === selectedSubVariantId) ?? null

  const variantSellUnitId = selectedVariant?.sell_unit_id ?? null
  const sellUnit = useMemo(() => {
    if (selectedSubVariantId) {
      const u =
        productUnits.find(u => u.sub_variant_id === selectedSubVariantId && u.is_base) ??
        productUnits.find(u => u.sub_variant_id === selectedSubVariantId)
      if (u) return u
    }
    if (variantSellUnitId) {
      const u = productUnits.find(u => u.id === variantSellUnitId)
      if (u) return u
    }
    if (selectedVariantId) {
      const u =
        productUnits.find(u => u.variant_id === selectedVariantId && u.sub_variant_id === null && u.is_base) ??
        productUnits.find(u => u.variant_id === selectedVariantId && u.sub_variant_id === null)
      if (u) return u
    }
    return (
      productUnits.find(u => u.variant_id === null && u.sub_variant_id === null && u.is_base) ?? productUnits[0] ?? null
    )
  }, [productUnits, selectedSubVariantId, selectedVariantId, variantSellUnitId])

  const effectiveUnitKey = sellUnit?.unit ?? 'unit'
  const effectiveUnitLabel = sellUnit?.display_label ?? sellUnit?.unit ?? null
  const unitFactor = sellUnit?.factor != null ? Number(sellUnit.factor) : 1

  const isContinuous =
    sellUnit?.dimension === 'length' ||
    sellUnit?.dimension === 'weight' ||
    sellUnit?.dimension === 'area' ||
    sellUnit?.dimension === 'volume'
  const qtyStep =
    sellUnit?.dimension === 'count'
      ? 1
      : sellUnit?.qty_step != null
        ? Number(sellUnit.qty_step)
        : isContinuous
          ? 0.001
          : 1
  const qtyMin = sellUnit?.min_qty != null ? Number(sellUnit.min_qty) : 1
  const qtyMax = sellUnit?.max_qty != null ? Number(sellUnit.max_qty) : undefined

  const baseUnit = useMemo(() => {
    const variantUnits = selectedVariantId ? productUnits.filter(u => u.variant_id === selectedVariantId) : []
    const productLevelUnits = productUnits.filter(u => u.variant_id === null)
    const pool = variantUnits.length > 0 ? variantUnits : productLevelUnits
    return pool.find(u => Number(u.factor) === 1 && u.unit !== (sellUnit?.unit ?? '')) ?? null
  }, [productUnits, selectedVariantId, sellUnit?.unit])
  const baseUnitLabel =
    baseUnit?.display_label ?? baseUnit?.unit ?? (unitFactor !== 1 && sellUnit?.dimension === 'count' ? 'pc' : null)
  const showPerBasePrice = unitFactor !== 1
  const perUnitLabel = showPerBasePrice ? (baseUnitLabel ?? effectiveUnitLabel) : effectiveUnitLabel
  const showPerUnit = !!perUnitLabel && !GENERIC_UNITS.has(String(perUnitLabel).trim().toLowerCase())

  const effectivePrice = useMemo(() => {
    if (selectedSubVariant) {
      if (!gstEnabled)
        return round2(
          pickUnitPrice({ inclusive: selectedSubVariant.price, exGst: selectedSubVariant.price_ex_gst }, false)
        )
      if (selectedSubVariant.price != null) return round2(Number(selectedSubVariant.price))
    }
    if (selectedVariant) {
      if (!gstEnabled)
        return round2(pickUnitPrice({ inclusive: selectedVariant.price, exGst: selectedVariant.price_ex_gst }, false))
      if (selectedVariant.price != null) return round2(Number(selectedVariant.price))
    }
    return 0
  }, [gstEnabled, selectedSubVariant, selectedVariant])

  const cap = pickerQtyCap(
    qtyMax,
    inCartQuantity(cartItems, {
      productId,
      variantId: selectedVariantId,
      subVariantId: selectedSubVariantId,
      buyMode: effectiveUnitKey,
    }),
    qtyMin
  )

  useEffect(() => {
    setQuantity(cap.min)
    setQuantityRaw(isContinuous ? Number(cap.min.toFixed(6)).toString() : String(cap.min))
  }, [selectedVariantId, selectedSubVariantId, effectiveUnitKey, cap.min, isContinuous])

  useEffect(() => {
    const subs = selectedVariant?.sub_variants ?? []
    if (subs.length > 0) {
      const stillValid = subs.find(s => s.id === selectedSubVariantId)
      if (!stillValid) {
        const firstActive =
          subs.find(s => s.is_active && s.stock_status !== 'Out of Stock') ?? subs.find(s => s.is_active) ?? subs[0]
        setSelectedSubVariantId(firstActive?.id ?? null)
      }
    } else {
      setSelectedSubVariantId(null)
    }
  }, [selectedVariantId])

  const selectedInStock =
    (selectedSubVariantId
      ? subVariants.find(s => s.id === selectedSubVariantId)?.stock_status
      : selectedVariant?.stock_status) !== 'Out of Stock'
  const pickerStock = selectedInStock ? Number.MAX_SAFE_INTEGER : 0

  const onConfirm = useCallback(async () => {
    if (adding) return
    if (subVariants.length > 0 && !selectedSubVariantId) {
      showToast(`Please select a ${selectedVariant?.sub_variant_type || 'sub-variant'}`, 'error')
      return
    }
    setAdding(true)
    if (isDigital) {
      const r = await startBuyNow(
        { productId, variantId: selectedVariantId, subVariantId: selectedSubVariantId, qty: 1 },
        portal
      )
      if (r.ok) {
        onClose()
        router.push(r.href)
      } else {
        showToast(r.error, 'error')
        setAdding(false)
      }
      return
    }
    try {
      await addToCart(
        productId,
        quantity,
        selectedVariantId || undefined,
        effectiveUnitKey,
        effectiveUnitKey,
        selectedSubVariantId || undefined
      )
      trackAddToCart({
        sku: selectedSubVariant?.sku || selectedVariant?.sku,
        name: productName,
        price: effectivePrice,
        quantity,
        variant: selectedSubVariant?.sub_variant_name || selectedVariant?.variant_name || null,
      })
      showToast('Item added to cart!', 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : 'Failed to add to cart', 'error')
    } finally {
      setAdding(false)
    }
  }, [
    adding,
    addToCart,
    effectivePrice,
    productName,
    selectedSubVariant,
    effectiveUnitKey,
    isDigital,
    portal,
    router,
    onClose,
    productId,
    quantity,
    selectedSubVariantId,
    selectedVariant,
    selectedVariantId,
    showToast,
    subVariants.length,
  ])

  const body = (
    <div className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto" onClick={onStop}>
      <div className="flex items-start gap-3">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={productName}
            className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl border border-border-default object-contain bg-surface-secondary"
          />
        ) : (
          <div className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl border border-border-default bg-surface-secondary" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-foreground leading-snug line-clamp-2">{productName}</h3>
          {brandName && <p className="text-sm text-foreground-secondary truncate">{brandName}</p>}
          {categoryName && <p className="text-sm text-foreground-secondary truncate">{categoryName}</p>}
        </div>
        <QuickAddHeaderActions
          productId={productId}
          productName={productName}
          slug={slug}
          href={productHref ?? `/products/${slug}`}
          showWishlist={portal !== 'business'}
          onClose={onClose}
          onStop={onStop}
        />
      </div>

      {(displayPrice != null || inStock != null) && (
        <div className="flex flex-col gap-2">
          {displayPrice != null && (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                From Rs. {displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {mrp != null && mrp > displayPrice && (
                <span className="text-sm text-foreground-muted line-through">
                  Rs. {mrp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
              {discountPct != null && discountPct > 0 && (
                <span className="rounded-full bg-accent-500 px-2 py-0.5 text-xs font-semibold text-white">
                  {discountPct}% off
                </span>
              )}
            </div>
          )}
          {inStock != null && (
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
                  inStock
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-surface-secondary text-foreground-muted'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${inStock ? 'bg-green-500' : 'bg-foreground-muted'}`} />
                {inStock ? 'In Stock' : 'Out of Stock'}
              </span>
              <span className="text-foreground-muted">Incl. all taxes</span>
            </div>
          )}
        </div>
      )}

      {loading && <div className="py-8 text-center text-sm text-foreground-muted">Loading options...</div>}

      {error && !loading && (
        <div className="py-6 text-center">
          <p className="text-sm text-foreground-muted mb-3">Could not load options.</p>
          <a
            href={`/products/${slug}`}
            onClick={onStop}
            className="text-sm font-medium text-accent-600 dark:text-accent-400 underline underline-offset-2"
          >
            View product
          </a>
        </div>
      )}

      {!loading && !error && (
        <>
          <div>
            <span className="block text-xs font-medium text-foreground-secondary mb-1.5">
              Select {selectedVariant?.variant_type || variants.find(v => v.variant_type)?.variant_type || 'Variant'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {variants.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={e => {
                    onStop(e)
                    setSelectedVariantId(v.id)
                  }}
                  className={`px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-xs font-medium border transition-colors ${
                    selectedVariantId === v.id
                      ? 'bg-accent-500 text-white border-accent-500'
                      : v.stock_status !== 'Out of Stock'
                        ? 'bg-surface-elevated text-foreground-secondary border-border-secondary hover:border-accent-400'
                        : 'bg-surface-secondary text-foreground-muted border-dashed border-border-default'
                  }`}
                >
                  {v.variant_name}
                  {v.stock_status === 'Out of Stock' && ' (Out of Stock)'}
                </button>
              ))}
            </div>
          </div>

          {subVariants.length > 0 && (
            <div>
              <span className="block text-xs font-medium text-foreground-secondary mb-1.5">
                Select {selectedVariant?.sub_variant_type || 'Sub-Variant'}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {subVariants.map(sv => (
                  <button
                    key={sv.id}
                    type="button"
                    onClick={e => {
                      onStop(e)
                      setSelectedSubVariantId(sv.id)
                    }}
                    className={`px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-xs font-medium border transition-colors ${
                      selectedSubVariantId === sv.id
                        ? 'bg-accent-500 text-white border-accent-500'
                        : sv.stock_status !== 'Out of Stock'
                          ? 'bg-surface-elevated text-foreground-secondary border-border-secondary hover:border-accent-400'
                          : 'bg-surface-secondary text-foreground-muted border-dashed border-border-default'
                    }`}
                  >
                    {sv.sub_variant_name}
                    {sv.stock_status === 'Out of Stock' && ' (Out of Stock)'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold text-primary-600 dark:text-primary-400">
              Rs.{' '}
              {(effectivePrice * unitFactor).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            {showPerUnit && (
              <span className="text-xs text-foreground-secondary">
                / <UnitLabel label={perUnitLabel} />
              </span>
            )}
          </div>

          {!isDigital && !cap.full && (
            <QuantityInput
              dimension={sellUnit?.dimension ?? 'count'}
              quantity={quantity}
              quantityRaw={quantityRaw}
              unitLabel={effectiveUnitLabel}
              unitKey={effectiveUnitKey}
              effectiveStock={pickerStock}
              qtyStep={qtyStep}
              qtyMin={cap.min}
              qtyMax={cap.max}
              onChange={(qty, raw) => {
                setQuantity(qty)
                setQuantityRaw(raw)
              }}
            />
          )}

          {!isDigital && <InCartQtyHint cap={cap} unitLabel={effectiveUnitLabel} />}

          <button
            type="button"
            onClick={e => {
              onStop(e)
              onConfirm()
            }}
            disabled={adding || (!isDigital && cap.full)}
            className="w-full min-h-[44px] sm:min-h-0 bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
          >
            {isDigital
              ? adding
                ? 'Processing...'
                : 'Buy Now'
              : adding
                ? 'Adding...'
                : cap.full
                  ? 'Max quantity already in cart'
                  : 'Add to cart'}
          </button>
        </>
      )}
    </div>
  )

  if (typeof document === 'undefined') return null

  const overlay = (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      onClick={onStop}
      role="dialog"
      aria-modal="true"
      aria-label={isDigital ? 'Quick buy' : 'Quick add to cart'}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={prefersReduced ? false : { y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        onClick={onStop}
        className="relative w-full sm:w-[26rem] sm:max-w-[calc(100vw-2rem)] max-sm:max-h-[92dvh] max-sm:overflow-y-auto max-sm:overscroll-contain bg-surface-elevated rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 pb-[calc(1.25rem+max(0.75rem,env(safe-area-inset-bottom)))] sm:pb-5"
      >
        <div className="w-10 h-1 bg-border-default rounded-full mx-auto mb-4 sm:hidden" />
        {body}
      </motion.div>
    </div>
  )

  return createPortal(overlay, document.body)
}

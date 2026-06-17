'use client'

import { useState, useEffect, useRef } from 'react'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import QuantityInput from '@/components/shared/QuantityInput'

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
  stock_quantity: number
  is_active: boolean
}

interface Variant {
  id: string
  variant_name: string
  sku: string
  price: number | null
  mrp: number | null
  mrp_ex_gst: number | null
  price_ex_gst: number | null
  wholeprice_ex_gst: number | null
  stock_quantity: number
  pricing_type?: string
  unit?: string
  numeric_value?: number | null
  variant_type?: string | null
  sub_variant_type?: string | null
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
  is_sell_default: boolean
  is_purchase_default: boolean
  display_label: string | null
  dimension: string
  min_qty?: number | null
  max_qty?: number | null
  qty_step?: number | null
}

interface ProductActionsProps {
  productId: string
  productName: string
  sku: string
  stockQuantity: number
  basePrice: number
  salePrice: number | null
  mrp: number | null
  gstPercentage: number | null
  wholesalePrice: number | null
  variants: Variant[]
  variantType: string
  initialSkuParam?: string
  discountPct?: number | null
  onVariantChange?: (variant: Variant | null) => void
  productUnits?: ProductUnit[]
}

const MODE_LABELS: Record<string, string> = {
  unit: 'By Piece',
}

function UnitLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null
  const match = label.match(/^(.+?)2$/)
  if (match) return <>{match[1]}<sup>2</sup></>
  return <>{label}</>
}

function getPerUnitRate(price: number, numeric_value: number, unit: string): string {
  if (!price || !numeric_value || numeric_value === 0) return ''
  let rate = price / numeric_value
  let label = `/${unit}`
  if (unit === 'g') {
    rate = (price / numeric_value) * 100
    label = '/100g'
  }
  return `₹${rate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${label}`
}

export default function ProductActions({
  productId, productName, sku, stockQuantity,
  basePrice, salePrice, mrp, gstPercentage, wholesalePrice,
  variants, variantType, initialSkuParam, discountPct,
  onVariantChange, productUnits: productUnitsProp,
}: ProductActionsProps) {
  const { addToCart } = useCart()
  const { showToast } = useToast()
  const router = useRouter()
  const [isAddingToCart, setIsAddingToCart] = useState(false)
  const [isBuyingNow, setIsBuyingNow] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [quantityRaw, setQuantityRaw] = useState('1')

  const pricingTypes = Array.from(new Set(variants.map(v => v.pricing_type || 'unit')))
  const hasMultipleModes = pricingTypes.length > 1

  const [selectedMode, setSelectedMode] = useState<string>(() => {
    if (variants.length === 0) return 'unit'
    if (initialSkuParam) {
      const variantMatch = variants.find(v => v.sku === initialSkuParam)
      if (variantMatch) return variantMatch.pricing_type || 'unit'
      const subMatch = variants.find(v => v.sub_variants?.some(sv => sv.sku === initialSkuParam))
      if (subMatch) return subMatch.pricing_type || 'unit'
    }
    return pricingTypes[0] || 'unit'
  })

  const modeVariants = variants.filter(v => (v.pricing_type || 'unit') === selectedMode)

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(() => {
    if (variants.length === 0) return null
    if (initialSkuParam) {
      const variantMatch = variants.find(v => v.sku === initialSkuParam)
      if (variantMatch) return variantMatch.id
      const subMatch = variants.find(v => v.sub_variants?.some(sv => sv.sku === initialSkuParam))
      if (subMatch) return subMatch.id
    }
    return modeVariants[0]?.id ?? variants[0].id
  })
  const [selectedSubVariantId, setSelectedSubVariantId] = useState<string | null>(() => {
    if (initialSkuParam) {
      for (const v of variants) {
        const sv = v.sub_variants?.find(s => s.sku === initialSkuParam)
        if (sv) return sv.id
      }
    }
    const initialVariant = variants.find(v => {
      if (initialSkuParam && v.sku === initialSkuParam) return true
      return false
    }) || variants.filter(v => (v.pricing_type || 'unit') === (variants[0]?.pricing_type || 'unit'))[0] || variants[0]
    const subs = initialVariant?.sub_variants || []
    if (subs.length > 0) {
      const firstActive = subs.find(s => s.is_active && (s.stock_quantity ?? 0) > 0) || subs.find(s => s.is_active) || subs[0]
      return firstActive?.id ?? null
    }
    return null
  })

  const [showAllVariants, setShowAllVariants] = useState(false)
  const [showAllSubVariants, setShowAllSubVariants] = useState(false)
  const VARIANT_COLLAPSE_LIMIT = 12

  const hasVariants = variants.length > 0
  const selectedVariant = variants.find(v => v.id === selectedVariantId)
  const displaySku = hasVariants && selectedVariant ? selectedVariant.sku : sku

  const modeInitDone = useRef(false)
  useEffect(() => {
    if (!modeInitDone.current) {
      modeInitDone.current = true
      return
    }
    const first = variants.filter(v => (v.pricing_type || 'unit') === selectedMode)[0]
    if (first) setSelectedVariantId(first.id)
  }, [selectedMode])

  const subVariantInitFromUrl = useRef(true)
  useEffect(() => {
    if (subVariantInitFromUrl.current) {
      subVariantInitFromUrl.current = false
      return
    }
    const v = variants.find(x => x.id === selectedVariantId)
    const subs = v?.sub_variants || []
    if (subs.length > 0) {
      const currentStillValid = subs.find(s => s.id === selectedSubVariantId)
      if (!currentStillValid) {
        const firstActive = subs.find(s => s.is_active && (s.stock_quantity ?? 0) > 0) || subs.find(s => s.is_active) || subs[0]
        setSelectedSubVariantId(firstActive?.id ?? null)
      }
    } else {
      setSelectedSubVariantId(null)
    }
  }, [selectedVariantId])

  useEffect(() => {
    if (!hasVariants || !selectedVariant) return
    const url = new URL(window.location.href)
    const sub = selectedVariant.sub_variants?.find(s => s.id === selectedSubVariantId)
    const skuToShow = sub?.sku || selectedVariant.sku
    url.searchParams.set('sku', skuToShow)
    window.history.replaceState(null, '', url.toString())
  }, [selectedVariantId, selectedSubVariantId, hasVariants, selectedVariant])

  useEffect(() => {
    if (onVariantChange) onVariantChange(selectedVariant ?? null)
  }, [selectedVariantId])

  const selectedSubVariant = selectedVariant?.sub_variants?.find(sv => sv.id === selectedSubVariantId) ?? null

  const gstMultiplier = 1 + (gstPercentage ?? 0) / 100
  const toInclGst = (exGst: number) => Math.round(exGst * gstMultiplier * 100) / 100

  const effectivePrice = hasVariants
    ? (selectedSubVariant?.price_ex_gst != null
        ? toInclGst(Number(selectedSubVariant.price_ex_gst))
        : (() => {
            const varMrp = selectedVariant?.mrp != null ? Number(selectedVariant.mrp) : null
            if (varMrp != null && discountPct != null) {
              return Math.round(varMrp * (1 - discountPct / 100) * 100) / 100
            }
            if (selectedVariant?.price_ex_gst != null) return toInclGst(Number(selectedVariant.price_ex_gst))
            return basePrice
          })())
    : (salePrice ?? basePrice)
  const effectiveMrp = hasVariants
    ? (selectedSubVariant?.mrp != null ? Number(selectedSubVariant.mrp) : (selectedVariant?.mrp != null ? Number(selectedVariant.mrp) : mrp))
    : mrp
  const effectiveWholesalePrice = hasVariants
    ? (selectedVariant?.wholeprice_ex_gst != null ? Number(selectedVariant.wholeprice_ex_gst) : wholesalePrice)
    : wholesalePrice
  const effectiveStock = hasVariants
    ? (selectedSubVariant ? selectedSubVariant.stock_quantity : (selectedVariant?.stock_quantity ?? 0))
    : stockQuantity

  const mrpDiscount = effectiveMrp && effectiveMrp > effectivePrice
    ? Math.round(((effectiveMrp - effectivePrice) / effectiveMrp) * 100)
    : 0

  const perUnitRate = selectedVariant?.pricing_type && selectedVariant.pricing_type !== 'unit'
    && selectedVariant.numeric_value && selectedVariant.unit
    ? getPerUnitRate(effectivePrice, selectedVariant.numeric_value, selectedVariant.unit)
    : null

  const productUnits = productUnitsProp ?? []
  const sellUnit = (() => {
    if (!selectedVariantId) {
      return productUnits.find(u => u.variant_id === null && u.sub_variant_id === null && u.is_sell_default)
        ?? productUnits.find(u => u.variant_id === null && u.sub_variant_id === null && u.is_base)
        ?? null
    }
    if (selectedSubVariantId) {
      const svUnit = productUnits.find(u => u.sub_variant_id === selectedSubVariantId && u.is_sell_default)
        ?? productUnits.find(u => u.sub_variant_id === selectedSubVariantId && u.is_base)
        ?? productUnits.find(u => u.sub_variant_id === selectedSubVariantId)
      if (svUnit) return svUnit
    }
    return productUnits.find(u => u.variant_id === selectedVariantId && u.sub_variant_id === null && u.is_sell_default)
      ?? productUnits.find(u => u.variant_id === selectedVariantId && u.sub_variant_id === null && u.is_base)
      ?? productUnits.find(u => u.variant_id === selectedVariantId && u.sub_variant_id === null)
      ?? productUnits.find(u => u.variant_id === null && u.sub_variant_id === null && u.is_sell_default)
      ?? productUnits.find(u => u.variant_id === null && u.sub_variant_id === null && u.is_base)
      ?? null
  })()
  const effectiveUnitKey = sellUnit?.unit ?? 'unit'
  const effectiveUnitLabel = sellUnit?.display_label ?? sellUnit?.unit ?? null

  const isContinuous = sellUnit?.dimension === 'length' || sellUnit?.dimension === 'weight' || sellUnit?.dimension === 'area' || sellUnit?.dimension === 'volume'
  const unitFactor = sellUnit?.factor != null ? Number(sellUnit.factor) : 1
  // baseUnit = the factor-1 unit that is distinct from the sell unit (e.g. "pc" when selling by "pair")
  const baseUnit = (() => {
    const variantUnits = selectedVariantId ? productUnits.filter(u => u.variant_id === selectedVariantId) : []
    const productLevelUnits = productUnits.filter(u => u.variant_id === null)
    const pool = variantUnits.length > 0 ? variantUnits : productLevelUnits
    return pool.find(u => Number(u.factor) === 1 && u.unit !== (sellUnit?.unit ?? '')) ?? null
  })()
  const baseUnitLabel = baseUnit?.display_label ?? baseUnit?.unit ?? null
  const showPerBasePrice = unitFactor !== 1
  const qtyStep = sellUnit?.dimension === 'count'
    ? 1
    : (sellUnit?.qty_step != null ? Number(sellUnit.qty_step) : (isContinuous ? 0.001 : 1))
  const qtyMin = sellUnit?.min_qty != null ? Number(sellUnit.min_qty) : 1
  const qtyMax = sellUnit?.max_qty != null ? Number(sellUnit.max_qty) : undefined

  useEffect(() => {
    setQuantity(qtyMin)
    setQuantityRaw(String(qtyMin))
  }, [selectedVariantId])

  useEffect(() => {
    const initial = qtyMin
    setQuantity(initial)
    setQuantityRaw(isContinuous ? Number(initial.toFixed(6)).toString() : String(initial))
  }, [effectiveUnitKey])

  const handleAddToCart = async () => {
    setIsAddingToCart(true)
    try {
      if (selectedVariant?.sub_variants && selectedVariant.sub_variants.length > 0 && !selectedSubVariantId) {
        showToast(`Please select a ${selectedVariant.sub_variant_type || 'sub-variant'}`, 'error')
        return
      }
      await addToCart(productId, quantity, selectedVariantId || undefined, effectiveUnitKey, effectiveUnitKey, selectedSubVariantId || undefined)
      showToast('Item added to cart!', 'success')
    } catch (error: any) {
      showToast(error.message || 'Failed to add to cart', 'error')
    } finally {
      setIsAddingToCart(false)
    }
  }

  const handleBuyNow = async () => {
    setIsBuyingNow(true)
    if (selectedVariant?.sub_variants && selectedVariant.sub_variants.length > 0 && !selectedSubVariantId) {
      showToast(`Please select a ${selectedVariant.sub_variant_type || 'sub-variant'}`, 'error')
      setIsBuyingNow(false)
      return
    }
    try {
      const res = await fetch('/api/checkout/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          productId,
          variantId: selectedVariantId || null,
          subVariantId: selectedSubVariantId || null,
          qty: quantity,
          buyMode: effectiveUnitKey,
          buyUnit: effectiveUnitKey,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.intent) {
        showToast(data?.error || 'Failed to start checkout', 'error')
        setIsBuyingNow(false)
        return
      }
      router.push(`/checkout/review?intent=${encodeURIComponent(data.intent)}`)
    } catch {
      showToast('Could not reach the server. Please try again.', 'error')
      setIsBuyingNow(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-foreground-secondary">
        SKU: <span className="font-medium text-foreground">{displaySku}</span>
      </div>

      {hasVariants && (
        <div className="space-y-3">
          {hasMultipleModes && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                Buy by
              </label>
              <div className="flex flex-wrap gap-2">
                {pricingTypes.map(pt => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setSelectedMode(pt)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      selectedMode === pt
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-surface-elevated text-foreground-secondary border-border-secondary hover:border-primary-400'
                    }`}
                  >
                    {MODE_LABELS[pt] || pt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              {hasMultipleModes
                ? (selectedMode === 'unit' ? `Select ${variants.find(v => v.variant_type)?.variant_type || variantType || 'Variant'}` : `Select ${selectedMode === 'weight' ? 'Weight' : 'Length'}`)
                : `Select ${variants.find(v => v.variant_type)?.variant_type || variantType || 'Variant'}`}
            </label>
            {(() => {
              const selectedHiddenIndex = modeVariants.findIndex(v => v.id === selectedVariantId)
              const mustExpand = !showAllVariants && selectedHiddenIndex >= VARIANT_COLLAPSE_LIMIT
              const collapsed = !showAllVariants && !mustExpand && modeVariants.length > VARIANT_COLLAPSE_LIMIT
              const visible = collapsed ? modeVariants.slice(0, VARIANT_COLLAPSE_LIMIT) : modeVariants
              const hiddenCount = modeVariants.length - visible.length
              return (
                <>
                  <div className="flex flex-wrap gap-2">
                    {visible.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => setSelectedVariantId(variant.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          selectedVariantId === variant.id
                            ? 'bg-accent-500 text-white border-accent-500'
                            : variant.stock_quantity > 0
                              ? 'bg-surface-elevated text-foreground-secondary border-border-secondary hover:border-accent-400'
                              : 'bg-surface-secondary text-foreground-muted border-border-default cursor-not-allowed'
                        }`}
                        disabled={variant.stock_quantity === 0}
                      >
                        {variant.variant_name}
                        {variant.stock_quantity === 0 && ' (Out of Stock)'}
                      </button>
                    ))}
                  </div>
                  {modeVariants.length > VARIANT_COLLAPSE_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllVariants(s => !s)}
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-600 dark:text-accent-400 hover:text-accent-700 transition-colors"
                    >
                      {showAllVariants ? 'Show fewer' : `Show all ${modeVariants.length} options`}
                      <svg className={`w-4 h-4 transition-transform ${showAllVariants ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                </>
              )
            })()}
          </div>

          {selectedVariant?.sub_variants && selectedVariant.sub_variants.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                Select {selectedVariant.sub_variant_type || 'Sub-Variant'}
              </label>
              {(() => {
                const subs = selectedVariant.sub_variants!
                const selectedHiddenIndex = subs.findIndex(s => s.id === selectedSubVariantId)
                const mustExpand = !showAllSubVariants && selectedHiddenIndex >= VARIANT_COLLAPSE_LIMIT
                const collapsed = !showAllSubVariants && !mustExpand && subs.length > VARIANT_COLLAPSE_LIMIT
                const visible = collapsed ? subs.slice(0, VARIANT_COLLAPSE_LIMIT) : subs
                return (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {visible.map((sv) => (
                        <button
                          key={sv.id}
                          type="button"
                          disabled={sv.stock_quantity === 0}
                          onClick={() => setSelectedSubVariantId(sv.id)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            selectedSubVariantId === sv.id
                              ? 'bg-accent-500 text-white border-accent-500'
                              : sv.stock_quantity > 0
                                ? 'bg-surface-elevated text-foreground-secondary border-border-secondary hover:border-accent-400'
                                : 'bg-surface-secondary text-foreground-muted border-border-default cursor-not-allowed'
                          }`}
                        >
                          {sv.sub_variant_name}
                          {sv.stock_quantity === 0 && ' (Out of Stock)'}
                        </button>
                      ))}
                    </div>
                    {subs.length > VARIANT_COLLAPSE_LIMIT && (
                      <button
                        type="button"
                        onClick={() => setShowAllSubVariants(s => !s)}
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-600 dark:text-accent-400 hover:text-accent-700 transition-colors"
                      >
                        {showAllSubVariants ? 'Show fewer' : `Show all ${subs.length} options`}
                        <svg className={`w-4 h-4 transition-transform ${showAllSubVariants ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {hasVariants && (
        <>
          <div className="bg-surface rounded-lg p-6">
            {/* Big orange = base unit price (per m, per kg, per pc etc.) */}
            <div className="flex items-baseline gap-2 flex-wrap mb-1">
              <span className="text-4xl font-bold text-primary-600 dark:text-primary-400">
                Rs. {effectivePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-sm text-foreground-secondary">/ <UnitLabel label={showPerBasePrice ? (baseUnitLabel ?? effectiveUnitLabel) : effectiveUnitLabel} /></span>
              {effectiveMrp && effectiveMrp > effectivePrice && (
                <span className="text-xl text-foreground-muted line-through">
                  Rs. {effectiveMrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>
            {/* Selling unit price (e.g. per pair/box) on its own line */}
            {showPerBasePrice && (
              <div className="mb-1">
                <span className="text-base font-semibold text-foreground">
                  Rs. {(effectivePrice * unitFactor).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / <UnitLabel label={effectiveUnitLabel} />
                </span>
              </div>
            )}

            {/* Total = selling unit price × qty */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-foreground-secondary">
                Total ({quantity} <UnitLabel label={effectiveUnitLabel ?? 'pc'} />):
              </span>
              <span className="text-base font-semibold text-foreground">
                Rs. {(effectivePrice * unitFactor * quantity).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>

            {mrpDiscount > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 px-3 py-1 rounded-full text-sm font-semibold">
                  {mrpDiscount}% off
                </span>
                <span className="text-sm text-foreground-secondary">
                  You save Rs. {((effectiveMrp! - effectivePrice) * unitFactor * quantity).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <p className="text-xs text-foreground-muted">
              Inclusive of all taxes{gstPercentage ? ` (${gstPercentage}% GST)` : ''}
            </p>
            {effectiveWholesalePrice && (
              <div className="mt-3 pt-3 border-t border-border-default">
                <span className="text-sm text-foreground-secondary">
                  Wholesale Price: <span className="font-semibold text-foreground">Rs. {(effectiveWholesalePrice * (1 + (gstPercentage || 0) / 100) * unitFactor).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / <UnitLabel label={effectiveUnitLabel ?? 'pc'} /></span>
                </span>
              </div>
            )}
          </div>

          <div>
            {effectiveStock > 0 ? (
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-green-700 dark:text-green-400 font-semibold">In Stock{effectiveStock < 10 ? <> ({effectiveStock}{effectiveUnitLabel ? <> <UnitLabel label={effectiveUnitLabel} /></> : ''} left)</> : ''}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span className="text-red-700 dark:text-red-400 font-semibold">Out of Stock</span>
              </div>
            )}
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-2">
          Quantity{effectiveUnitLabel && effectiveUnitKey !== 'unit' ? <> (<UnitLabel label={effectiveUnitLabel} />)</> : ''}
        </label>
        <QuantityInput
          dimension={sellUnit?.dimension ?? 'count'}
          quantity={quantity}
          quantityRaw={quantityRaw}
          unitLabel={effectiveUnitLabel}
          unitKey={effectiveUnitKey}
          effectiveStock={effectiveStock}
          qtyStep={qtyStep}
          qtyMin={qtyMin}
          qtyMax={qtyMax}
          onChange={(qty, raw) => { setQuantity(qty); setQuantityRaw(raw) }}
        />
      </div>

      <div className="space-y-3">
        <button
          onClick={handleBuyNow}
          disabled={effectiveStock === 0 || isBuyingNow}
          className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed active:scale-[0.98] hover:shadow-lg"
        >
          {isBuyingNow ? (
            <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />Processing...</>
          ) : (
            <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Buy Now</>
          )}
        </button>

        <button
          onClick={handleAddToCart}
          disabled={effectiveStock === 0 || isAddingToCart}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white px-6 py-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed active:scale-[0.98] hover:shadow-lg"
        >
          {isAddingToCart ? (
            <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />Adding...</>
          ) : (
            <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>Add to Cart</>
          )}
        </button>
      </div>

    </div>
  )
}

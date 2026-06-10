'use client'

import { useState, useEffect, useRef } from 'react'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { bp } from '@/lib/business-path'

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
  stock_quantity: number
  is_active: boolean
}

interface Variant {
  id: string
  variant_name: string
  sku: string
  price: number | null
  mrp: number | null
  price_ex_gst: number | null
  wholeprice_ex_gst: number | null
  stock_quantity: number
  pricing_type?: string
  unit?: string
  numeric_value?: number | null
  weight_rate?: number | null
  weight_unit?: string | null
  length_rate?: number | null
  length_unit?: string | null
  variant_type?: string | null
  sub_variant_type?: string | null
  variant_images?: VariantImage[]
  sub_variants?: SubVariant[]
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
  weightRate?: number | null
  weightUnit?: string | null
  lengthRate?: number | null
  lengthUnit?: string | null
  onVariantChange?: (variant: Variant | null) => void
  onSelectionChange?: (variantId: string | null, subVariantId: string | null) => void
  categoryId?: string | null
}

const MODE_LABELS: Record<string, string> = {
  unit: 'By Piece',
  weight: 'By Weight',
  length: 'By Length',
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
  variants, variantType, initialSkuParam,
  weightRate, weightUnit, lengthRate, lengthUnit,
  onVariantChange, onSelectionChange, categoryId,
}: ProductActionsProps) {
  const { addToCart } = useCart()
  const { showToast } = useToast()
  const router = useRouter()
  const { user } = useAuth()
  const [isAddingToCart, setIsAddingToCart] = useState(false)
  const [isBuyingNow, setIsBuyingNow] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [quantityRaw, setQuantityRaw] = useState('1')
  useEffect(() => { setQuantityRaw(String(quantity)) }, [quantity])
  const [customQty, setCustomQty] = useState('1')

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

  useEffect(() => {
    if (onSelectionChange) onSelectionChange(selectedVariantId, selectedSubVariantId)
  }, [selectedVariantId, selectedSubVariantId])

  const selectedSubVariant = selectedVariant?.sub_variants?.find(sv => sv.id === selectedSubVariantId) ?? null

  const businessDiscountPct = (user?.isBusiness && user.approvalStatus === 'approved' && categoryId)
    ? (user.businessDiscountMap?.[categoryId] ?? 0)
    : 0

  const rawEffectivePrice = hasVariants
    ? (selectedSubVariant?.price != null ? Number(selectedSubVariant.price) : (selectedVariant?.price ?? basePrice))
    : (salePrice ?? basePrice)
  const effectivePrice = businessDiscountPct > 0
    ? rawEffectivePrice * (1 - businessDiscountPct / 100)
    : rawEffectivePrice
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

  const activeWeightRate = hasVariants
    ? (selectedVariant?.weight_rate ?? null)
    : (weightRate ?? null)
  const activeWeightUnit = hasVariants
    ? (selectedVariant?.weight_unit ?? weightUnit ?? 'kg')
    : (weightUnit ?? 'kg')
  const activeLengthRate = hasVariants
    ? (selectedVariant?.length_rate ?? null)
    : (lengthRate ?? null)
  const activeLengthUnit = hasVariants
    ? (selectedVariant?.length_unit ?? lengthUnit ?? 'm')
    : (lengthUnit ?? 'm')

  const nonVariantBuyModes: string[] = ['unit']
  if (!hasVariants) {
    if (activeWeightRate) nonVariantBuyModes.push('weight')
    if (activeLengthRate) nonVariantBuyModes.push('length')
  }
  const hasNonVariantCustomModes = !hasVariants && nonVariantBuyModes.length > 1

  const [buyMode, setBuyMode] = useState<string>('unit')

  useEffect(() => {
    setBuyMode('unit')
    setCustomQty('1')
    setQuantity(1)
  }, [selectedVariantId])

  const currentRate = buyMode === 'weight' ? activeWeightRate : buyMode === 'length' ? activeLengthRate : null
  const currentUnit = buyMode === 'weight' ? activeWeightUnit : buyMode === 'length' ? activeLengthUnit : null

  const variantHasCustomWeight = hasVariants && (activeWeightRate != null)
  const variantHasCustomLength = hasVariants && (activeLengthRate != null)
  const variantCustomModes: string[] = hasVariants
    ? ['unit', ...(variantHasCustomWeight ? ['weight'] : []), ...(variantHasCustomLength ? ['length'] : [])]
    : []
  const variantHasMultipleBuyModes = variantCustomModes.length > 1

  const parsedCustomQty = parseFloat(customQty) || 0
  const customTotal = currentRate ? parsedCustomQty * currentRate : 0

  useEffect(() => {
    if (buyMode !== 'unit') return
    setCustomQty('1')
  }, [buyMode])

  useEffect(() => {
    if (hasNonVariantCustomModes && !nonVariantBuyModes.includes(buyMode)) {
      setBuyMode('unit')
    }
  }, [weightRate, lengthRate])

  useEffect(() => {
    if (hasVariants && !variantCustomModes.includes(buyMode)) {
      setBuyMode('unit')
    }
  }, [selectedVariantId])

  useEffect(() => {
    setQuantity(1)
  }, [selectedVariantId])

  const handleAddToCart = async () => {
    setIsAddingToCart(true)
    try {
      const finalQty = (buyMode === 'weight' || buyMode === 'length') ? parsedCustomQty : quantity
      if ((buyMode === 'weight' || buyMode === 'length') && finalQty <= 0) {
        showToast('Enter a valid quantity', 'error')
        return
      }
      if (selectedVariant?.sub_variants && selectedVariant.sub_variants.length > 0 && !selectedSubVariantId) {
        showToast(`Please select a ${selectedVariant.sub_variant_type || 'sub-variant'}`, 'error')
        return
      }
      await addToCart(productId, finalQty, selectedVariantId || undefined, buyMode, currentUnit || undefined, selectedSubVariantId || undefined)
      showToast('Item added to cart!', 'success')
    } catch (error: any) {
      showToast(error.message || 'Failed to add to cart', 'error')
    } finally {
      setIsAddingToCart(false)
    }
  }

  const handleBuyNow = async () => {
    setIsBuyingNow(true)
    const finalQty = (buyMode === 'weight' || buyMode === 'length') ? parsedCustomQty : quantity
    if ((buyMode === 'weight' || buyMode === 'length') && finalQty <= 0) {
      showToast('Enter a valid quantity', 'error')
      setIsBuyingNow(false)
      return
    }
    if (selectedVariant?.sub_variants && selectedVariant.sub_variants.length > 0 && !selectedSubVariantId) {
      showToast(`Please select a ${selectedVariant.sub_variant_type || 'sub-variant'}`, 'error')
      setIsBuyingNow(false)
      return
    }
    try {
      const res = await fetch('/api/checkout/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Portal': 'business' },
        credentials: 'include',
        body: JSON.stringify({
          productId,
          variantId: selectedVariantId || null,
          subVariantId: selectedSubVariantId || null,
          qty: finalQty,
          buyMode,
          buyUnit: currentUnit || null,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.intent) {
        showToast(data?.error || 'Failed to start checkout', 'error')
        setIsBuyingNow(false)
        return
      }
      router.push(bp(`/business/checkout/review?intent=${encodeURIComponent(data.intent)}`))
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
            {businessDiscountPct > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm text-foreground-secondary shrink-0">Regular price</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className="text-base text-foreground-muted line-through tabular-nums">
                      Rs.&nbsp;{rawEffectivePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    {effectiveMrp && effectiveMrp > rawEffectivePrice && (
                      <span className="text-sm text-foreground-muted line-through tabular-nums">
                        MRP Rs.&nbsp;{effectiveMrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mb-3">
                  <p className="text-sm font-semibold text-accent-600 dark:text-accent-400 mb-1">Your business price</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-3xl font-bold text-primary-600 dark:text-primary-400 tabular-nums">
                      Rs.&nbsp;{effectivePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700 whitespace-nowrap shrink-0">
                      ✦ {businessDiscountPct}% off
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-baseline gap-3 mb-2 flex-wrap">
                <span className="text-3xl font-bold text-primary-600 dark:text-primary-400 tabular-nums">
                  Rs.&nbsp;{effectivePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                {effectiveMrp && effectiveMrp > effectivePrice && (
                  <span className="text-lg text-foreground-muted line-through tabular-nums">
                    Rs.&nbsp;{effectiveMrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            )}
            {perUnitRate && (
              <p className="text-sm font-medium text-accent-600 dark:text-accent-400 mb-2">
                {perUnitRate}
              </p>
            )}
            {mrpDiscount > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 px-3 py-1 rounded-full text-sm font-semibold">
                  {mrpDiscount}% off
                </span>
                <span className="text-sm text-foreground-secondary">
                  You save Rs. {(effectiveMrp! - effectivePrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <p className="text-xs text-foreground-muted">
              Inclusive of all taxes{gstPercentage ? ` (${gstPercentage}% GST)` : ''}
            </p>
            {effectiveWholesalePrice && (
              <div className="mt-3 pt-3 border-t border-border-default">
                <span className="text-sm text-foreground-secondary">
                  Wholesale Price: <span className="font-semibold text-foreground">Rs. {(effectiveWholesalePrice * (1 + (gstPercentage || 0) / 100)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
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
                <span className="text-green-700 dark:text-green-400 font-semibold">In Stock{effectiveStock < 10 ? ` (${effectiveStock} left)` : ''}</span>
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

      {(hasNonVariantCustomModes || variantHasMultipleBuyModes) && (
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-2">How to buy</label>
          <div className="flex flex-wrap gap-2">
            {(hasVariants ? variantCustomModes : nonVariantBuyModes).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setBuyMode(mode)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                  buyMode === mode
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-surface-elevated text-foreground-secondary border-border-secondary hover:border-primary-400'
                }`}
              >
                {MODE_LABELS[mode] || mode}
              </button>
            ))}
          </div>
        </div>
      )}

      {(buyMode === 'weight' || buyMode === 'length') && currentRate ? (
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-2">
            Enter quantity ({currentUnit})
          </label>
          <div className="flex items-center gap-3">
            <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden">
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={customQty}
                onChange={e => setCustomQty(e.target.value)}
                className="w-28 px-3 py-2 text-center font-semibold bg-surface text-foreground focus:outline-none"
              />
              <span className="px-3 py-2 bg-surface-secondary text-foreground-secondary text-sm font-medium border-l border-border-secondary">
                {currentUnit}
              </span>
            </div>
            {parsedCustomQty > 0 && (
              <div className="text-sm text-foreground-secondary">
                = <span className="font-semibold text-primary-600 dark:text-primary-400">
                  Rs. {customTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs ml-1">({parsedCustomQty} {currentUnit} × Rs. {currentRate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/{currentUnit})</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-2">Quantity</label>
          <div className="flex items-center border border-border-secondary rounded-lg w-fit overflow-hidden">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
              className="px-4 py-2 hover:bg-surface-secondary transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <input
              type="number"
              min={1}
              max={effectiveStock}
              value={quantityRaw}
              onChange={e => {
                const raw = e.target.value
                setQuantityRaw(raw)
                if (raw === '' || raw === '0') return
                const v = parseInt(raw, 10)
                if (!isNaN(v)) setQuantity(Math.min(effectiveStock, Math.max(1, v)))
              }}
              onBlur={e => {
                const v = parseInt(e.target.value, 10)
                const clamped = isNaN(v) || v < 1 ? 1 : Math.min(effectiveStock, v)
                setQuantity(clamped)
                setQuantityRaw(String(clamped))
              }}
              className="w-16 py-2 border-x border-border-secondary text-center font-semibold bg-surface text-foreground focus:outline-none animate-fade-in [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              onClick={() => setQuantity(Math.min(effectiveStock, quantity + 1))}
              disabled={quantity >= effectiveStock}
              className="px-4 py-2 hover:bg-surface-secondary transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
      )}

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

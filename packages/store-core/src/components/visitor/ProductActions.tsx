'use client'

import { useState, useEffect, useRef } from 'react'
import { useCart } from '@/contexts/CartContext'
import { useFlyToCart } from '@/contexts/FlyToCartContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import QuantityInput from '@/components/shared/QuantityInput'
import InCartQtyHint from '@/components/shared/InCartQtyHint'
import { inCartQuantity, pickerQtyCap, unitCapError } from '@/lib/catalog/cart-unit-cap'
import { round2 } from '@/lib/catalog/gst'
import { trackAddToCart, trackViewItem } from '@/lib/client/analytics'
import { resolveEdd } from '@/lib/shipping/edd-cache'
import StickyAddToCartBar from './pdp/StickyAddToCartBar'
import { PDP_BUY_BUTTONS_ID, PDP_OPTIONS_ID, stickyBarAction } from './pdp/pdp'
import SubscribeOption, { type PurchaseMode } from '@/components/subscriptions/SubscribeOption'

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
  mrp_ex_gst: number | null
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

interface ProductActionsProps {
  productId: string
  productName: string
  sku: string
  stockStatus: string
  basePrice: number
  basePriceExGst?: number | null
  salePrice: number | null
  mrp: number | null
  gstPercentage: number | null
  variants: Variant[]
  variantType: string
  initialSkuParam?: string
  discountPct?: number | null
  onVariantChange?: (variant: Variant | null) => void
  /** The selected variant and sub-variant ids (media follows them). */
  onSelectionChange?: (variantId: string | null, subVariantId: string | null) => void
  onUnitChange?: (
    unitKey: string,
    unitLabel: string | null,
    unitMeta: { min: number; max: number | null; step: number; factor: number; dimension: string }
  ) => void
  productUnits?: ProductUnit[]
  sellUnitId?: string | null
  extraDeliveryDays?: number
  handlingDays?: number
  is_active?: boolean
  launchDate?: string | null
  discontinueDate?: string | null
  isCodAllowed?: boolean | null
  stickyImage?: string | null
  digital?: boolean
  alreadyOwned?: boolean
  vaultUrl?: string | null
  isSubscription?: boolean
  subscriptionIntervals?: string[] | null
}

const VARIANT_COLLAPSE_LIMIT = 12

const MODE_LABELS: Record<string, string> = {
  unit: 'By Piece',
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

export function useProductPurchase({
  productId,
  productName,
  sku,
  stockStatus,
  basePrice,
  basePriceExGst,
  salePrice,
  mrp,
  gstPercentage,
  variants,
  variantType,
  initialSkuParam,
  discountPct,
  onVariantChange,
  onSelectionChange,
  onUnitChange,
  productUnits: productUnitsProp,
  sellUnitId,
  extraDeliveryDays = 0,
  handlingDays = 2,
  is_active = true,
  launchDate,
  discontinueDate,
  isCodAllowed,
  stickyImage,
  digital = false,
  alreadyOwned = false,
  vaultUrl = null,
  isSubscription = false,
  subscriptionIntervals = null,
}: ProductActionsProps) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isPreLaunch = !!launchDate && new Date(launchDate) > today
  const isDiscontinued = !!discontinueDate && new Date(discontinueDate) <= today
  const gstEnabled = useStoreConfig().flags.gstEnabled
  const { addToCart, cartItems } = useCart()
  const fly = useFlyToCart()
  const { showToast } = useToast()
  const router = useRouter()
  const { user } = useAuth()
  const [edd, setEdd] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<any[]>([])
  const [selectedPin, setSelectedPin] = useState<string | null>(null)
  const [showAddressPicker, setShowAddressPicker] = useState(false)
  const addressPickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showAddressPicker) return
    function handleClickOutside(e: MouseEvent) {
      if (addressPickerRef.current && !addressPickerRef.current.contains(e.target as Node)) {
        setShowAddressPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddressPicker])
  useEffect(() => {
    if (!user) {
      resolveEdd(false, handlingDays, extraDeliveryDays).then(v => {
        if (v) setEdd(v)
      })
      return
    }
    fetch('/api/user/addresses')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const list = d?.addresses ?? []
        setAddresses(list)
        const pin = list.find((a: any) => a.is_default)?.postal_code ?? list[0]?.postal_code ?? null
        setSelectedPin(pin)
        return resolveEdd(true, handlingDays, extraDeliveryDays)
      })
      .then(v => {
        if (v) setEdd(v)
      })
      .catch(() => {})
  }, [user])
  function pickAddress(pin: string) {
    setSelectedPin(pin)
    setShowAddressPicker(false)
    fetch(
      `/api/products/edd?pin=${pin}&handlingDays=${handlingDays}${extraDeliveryDays > 0 ? '&extraDays=' + extraDeliveryDays : ''}`
    )
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.edd) setEdd(d.edd)
      })
      .catch(() => {})
  }
  const [isAddingToCart, setIsAddingToCart] = useState(false)
  const [isBuyingNow, setIsBuyingNow] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [quantityRaw, setQuantityRaw] = useState('1')
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>('once')
  const subscribing = purchaseMode === 'subscribe'

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
    const initialVariant =
      variants.find(v => {
        if (initialSkuParam && v.sku === initialSkuParam) return true
        return false
      }) ||
      variants.filter(v => (v.pricing_type || 'unit') === (variants[0]?.pricing_type || 'unit'))[0] ||
      variants[0]
    const subs = initialVariant?.sub_variants || []
    if (subs.length > 0) {
      const firstActive =
        subs.find(s => s.is_active && s.stock_status !== 'Out of Stock') || subs.find(s => s.is_active) || subs[0]
      return firstActive?.id ?? null
    }
    return null
  })

  const [showAllVariants, setShowAllVariants] = useState(false)
  const [showAllSubVariants, setShowAllSubVariants] = useState(false)

  const hasVariants = variants.length > 0
  const selectedVariant = variants.find(v => v.id === selectedVariantId)

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
        const firstActive =
          subs.find(s => s.is_active && s.stock_status !== 'Out of Stock') || subs.find(s => s.is_active) || subs[0]
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
    onSelectionChange?.(hasVariants ? (selectedVariantId ?? null) : null, hasVariants ? (selectedSubVariantId ?? null) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariantId, selectedSubVariantId, hasVariants])

  const selectedSubVariant = selectedVariant?.sub_variants?.find(sv => sv.id === selectedSubVariantId) ?? null

  // Show View cart when this product is in the cart. Prefer an exact variant +
  // sub-variant match, but fall back to a product-level match so it still shows
  // when the selected variant differs from what was added (or none is selected yet).
  const productInCart = cartItems.some(ci => ci.product_id === productId)
  const exactInCart = cartItems.some(
    ci =>
      ci.product_id === productId &&
      (ci.variant_id ?? null) === (selectedVariantId ?? null) &&
      (ci.sub_variant_id ?? null) === (selectedSubVariantId ?? null)
  )
  const inCart = exactInCart || productInCart
  const displaySku = hasVariants && selectedVariant ? selectedSubVariant?.sku || selectedVariant.sku : sku

  const gstMultiplier = 1 + (gstPercentage ?? 0) / 100
  const toInclGst = (exGst: number) => round2(exGst * gstMultiplier)
  const toExGst = (incl: number) => (gstMultiplier > 0 ? round2(incl / gstMultiplier) : incl)
  const discFactor = 1 - (discountPct ?? 0) / 100

  // Authoritative pricing model (mirrors the admin product form): when the
  // product carries a discount_pct, the stored price/price_ex_gst equals the MRP
  // and the discount is applied on top — so the sale price is derived as
  // MRP × (1 − discountPct/100). When discount_pct is 0 we use the stored price
  // as-is (it may already be discounted below MRP). MRP is taken in the correct
  // GST basis (ex-GST when the GST flag is off).
  const priceFromMrp = (inclMrp: number | null | undefined, exGstMrp: number | null | undefined): number | null => {
    if (!(discountPct != null && discountPct > 0)) return null
    const mrpBasis = !gstEnabled
      ? exGstMrp != null && Number(exGstMrp) > 0
        ? Number(exGstMrp)
        : inclMrp != null && Number(inclMrp) > 0
          ? toExGst(Number(inclMrp))
          : null
      : inclMrp != null && Number(inclMrp) > 0
        ? Number(inclMrp)
        : exGstMrp != null && Number(exGstMrp) > 0
          ? toInclGst(Number(exGstMrp))
          : null
    return mrpBasis != null ? round2(mrpBasis * discFactor) : null
  }

  const effectivePrice = hasVariants
    ? (() => {
        if (selectedSubVariant) {
          const fromMrp = priceFromMrp(selectedSubVariant.mrp, null)
          if (fromMrp != null) return fromMrp
          // No MRP on the sub-variant: fall back to its stored price.
          if (!gstEnabled)
            return round2(
              pickUnitPrice({ inclusive: selectedSubVariant.price, exGst: selectedSubVariant.price_ex_gst }, false)
            )
          if (selectedSubVariant.price != null) return round2(Number(selectedSubVariant.price))
          if (selectedSubVariant.price_ex_gst != null) return toInclGst(Number(selectedSubVariant.price_ex_gst))
        }
        if (selectedVariant) {
          const fromMrp = priceFromMrp(selectedVariant.mrp, selectedVariant.mrp_ex_gst)
          if (fromMrp != null) return fromMrp
          if (!gstEnabled)
            return round2(
              pickUnitPrice({ inclusive: selectedVariant.price, exGst: selectedVariant.price_ex_gst }, false)
            )
          if (selectedVariant.price != null) return round2(Number(selectedVariant.price))
        }
        return round2(pickUnitPrice({ inclusive: basePrice, exGst: basePriceExGst }, gstEnabled))
      })()
    : (() => {
        const fromMrp = priceFromMrp(mrp, null)
        if (fromMrp != null) return fromMrp
        return round2(pickUnitPrice({ inclusive: salePrice ?? basePrice, exGst: basePriceExGst }, gstEnabled))
      })()
  const effectiveMrpRaw = hasVariants
    ? selectedSubVariant?.mrp != null
      ? Number(selectedSubVariant.mrp)
      : selectedVariant?.mrp != null
        ? Number(selectedVariant.mrp)
        : mrp
    : mrp
  // When GST is off the price shown is ex-GST; strip GST from the MRP too so the
  // strike-through comparison and discount % stay on the same (ex-GST) basis.
  const effectiveMrp =
    !gstEnabled && effectiveMrpRaw != null && gstMultiplier > 0
      ? round2(Number(effectiveMrpRaw) / gstMultiplier)
      : effectiveMrpRaw
  const effectiveStock = hasVariants
    ? (selectedSubVariant ? selectedSubVariant.stock_status : selectedVariant?.stock_status) !== 'Out of Stock'
      ? 9999
      : 0
    : stockStatus !== 'Out of Stock'
      ? 9999
      : 0

  const mrpDiscount =
    effectiveMrp && effectiveMrp > effectivePrice
      ? Math.round(((effectiveMrp - effectivePrice) / effectiveMrp) * 100)
      : 0

  const perUnitRate =
    selectedVariant?.pricing_type &&
    selectedVariant.pricing_type !== 'unit' &&
    selectedVariant.numeric_value &&
    selectedVariant.unit
      ? getPerUnitRate(effectivePrice, selectedVariant.numeric_value, selectedVariant.unit)
      : null

  const productUnits = digital ? [] : (productUnitsProp ?? [])
  // Resolve MOST SPECIFIC GRAIN FIRST. A sell_unit_id pointer only speaks for the
  // grain that owns it: the variant's own pointer, never the product's standing in
  // for it. Collapsing the two (variant?.sell_unit_id ?? sellUnitId) made a
  // sub-variant with its own unit show the PRODUCT's unit, because the variant has
  // no pointer of its own and the product's matched before the sub-variant was read.
  const variantSellUnitId = selectedVariant?.sell_unit_id ?? null
  const sellUnit = (() => {
    // 1. Sub-variant's own unit row — the most specific grain.
    if (selectedSubVariantId) {
      const u =
        productUnits.find(u => u.sub_variant_id === selectedSubVariantId && u.is_base) ??
        productUnits.find(u => u.sub_variant_id === selectedSubVariantId)
      if (u) return u
    }
    // 2. Variant's explicit pointer, then its own unit row.
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
    // 3. Product-level pointer, then its own unit row.
    if (sellUnitId) {
      const u = productUnits.find(u => u.id === sellUnitId)
      if (u) return u
    }
    return (
      productUnits.find(u => u.variant_id === null && u.sub_variant_id === null && u.is_base) ?? productUnits[0] ?? null
    )
  })()
  const effectiveUnitKey = sellUnit?.unit ?? 'unit'
  const effectiveUnitLabel = sellUnit?.display_label ?? sellUnit?.unit ?? null

  const isContinuous =
    sellUnit?.dimension === 'length' ||
    sellUnit?.dimension === 'weight' ||
    sellUnit?.dimension === 'area' ||
    sellUnit?.dimension === 'volume'
  const unitFactor = sellUnit?.factor != null ? Number(sellUnit.factor) : 1
  // baseUnit = the factor-1 unit that is distinct from the sell unit (e.g. "pc" when selling by "pair")
  const baseUnit = (() => {
    const variantUnits = selectedVariantId ? productUnits.filter(u => u.variant_id === selectedVariantId) : []
    const productLevelUnits = productUnits.filter(u => u.variant_id === null)
    const pool = variantUnits.length > 0 ? variantUnits : productLevelUnits
    return pool.find(u => Number(u.factor) === 1 && u.unit !== (sellUnit?.unit ?? '')) ?? null
  })()
  const baseUnitLabel =
    baseUnit?.display_label ?? baseUnit?.unit ?? (unitFactor !== 1 && sellUnit?.dimension === 'count' ? 'pc' : null)
  const showPerBasePrice = unitFactor !== 1
  // The label shown after "Rs. X /". Hide the whole "/ unit" suffix when there
  // is no meaningful per-unit label (generic pieces/units) so we never render a
  // dangling "/".
  const perUnitLabel = showPerBasePrice ? (baseUnitLabel ?? effectiveUnitLabel) : effectiveUnitLabel
  const GENERIC_UNITS = new Set(['unit', 'units', 'pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'each'])
  const showPerUnit = !!perUnitLabel && !GENERIC_UNITS.has(String(perUnitLabel).trim().toLowerCase())
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
  // Input stays at max_qty for Buy Now; Add to Cart is capped by what this line already holds.
  const cartCap = pickerQtyCap(
    qtyMax,
    inCartQuantity(cartItems, {
      productId,
      variantId: selectedVariantId,
      subVariantId: selectedSubVariantId,
      buyMode: effectiveUnitKey,
    }),
    qtyMin
  )
  const addBlocked = cartCap.full || (cartCap.max != null && quantity > cartCap.max)

  useEffect(() => {
    setQuantity(qtyMin)
    setQuantityRaw(String(qtyMin))
  }, [selectedVariantId])

  useEffect(() => {
    const initial = qtyMin
    setQuantity(initial)
    setQuantityRaw(isContinuous ? Number(initial.toFixed(6)).toString() : String(initial))
  }, [effectiveUnitKey])

  useEffect(() => {
    onUnitChange?.(effectiveUnitKey, effectiveUnitLabel ?? null, {
      min: qtyMin,
      max: qtyMax ?? null,
      step: qtyStep,
      factor: unitFactor,
      dimension: sellUnit?.dimension ?? 'count',
    })
  }, [effectiveUnitKey, effectiveUnitLabel, qtyMin, qtyMax, qtyStep, unitFactor, sellUnit?.dimension])

  const selectedOptionName = selectedSubVariant?.sub_variant_name || selectedVariant?.variant_name || null
  const viewedSku = useRef<string | null>(null)
  useEffect(() => {
    if (!displaySku || viewedSku.current === displaySku) return
    viewedSku.current = displaySku
    trackViewItem({ sku: displaySku, name: productName, price: effectivePrice, variant: selectedOptionName })
  }, [displaySku, productName, effectivePrice, selectedOptionName])

  const handleAddToCart = async (origin?: HTMLElement | null) => {
    if (addBlocked) {
      showToast(unitCapError(qtyMax, cartCap.inCart, quantity) ?? 'Max quantity already in cart', 'error')
      return
    }
    setIsAddingToCart(true)
    try {
      if (selectedVariant?.sub_variants && selectedVariant.sub_variants.length > 0 && !selectedSubVariantId) {
        showToast(`Please select a ${selectedVariant.sub_variant_type || 'sub-variant'}`, 'error')
        return
      }
      await addToCart(
        productId,
        quantity,
        selectedVariantId || undefined,
        effectiveUnitKey,
        effectiveUnitKey,
        selectedSubVariantId || undefined
      )
      fly?.flyToCart(origin ?? null)
      trackAddToCart({
        sku: displaySku,
        name: productName,
        price: effectivePrice,
        quantity,
        variant: selectedOptionName,
      })
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

  return {
    productId,
    productName,
    variants,
    variantType,
    hasVariants,
    hasMultipleModes,
    pricingTypes,
    selectedMode,
    setSelectedMode,
    modeVariants,
    selectedVariantId,
    setSelectedVariantId,
    selectedSubVariantId,
    setSelectedSubVariantId,
    selectedVariant,
    selectedSubVariant,
    showAllVariants,
    setShowAllVariants,
    showAllSubVariants,
    setShowAllSubVariants,
    gstEnabled,
    gstPercentage,
    effectivePrice,
    effectiveMrp,
    effectiveStock,
    mrpDiscount,
    showPerUnit,
    perUnitLabel,
    showPerBasePrice,
    unitFactor,
    effectiveUnitKey,
    effectiveUnitLabel,
    baseUnitLabel,
    sellUnit,
    quantity,
    quantityRaw,
    setQuantity,
    setQuantityRaw,
    qtyStep,
    qtyMin,
    qtyMax,
    cartCap,
    addBlocked,
    edd,
    user,
    selectedPin,
    addresses,
    showAddressPicker,
    setShowAddressPicker,
    addressPickerRef,
    pickAddress,
    isCodAllowed,
    digital,
    alreadyOwned,
    vaultUrl,
    isSubscription,
    subscriptionIntervals,
    purchaseMode,
    setPurchaseMode,
    subscribing,
    is_active,
    launchDate,
    isPreLaunch,
    isDiscontinued,
    inCart,
    isAddingToCart,
    isBuyingNow,
    handleAddToCart,
    handleBuyNow,
    stickyImage,
  }
}

export type ProductPurchase = ReturnType<typeof useProductPurchase>
export type VariantPickerStyle = 'buttons' | 'swatches' | 'dropdown'

const OPTION_CLS = (selected: boolean, inStock: boolean) =>
  `min-h-11 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
    selected
      ? 'bg-accent-500 text-white border-accent-500'
      : inStock
        ? 'bg-surface-elevated text-foreground-secondary border-border-secondary hover:border-accent-400'
        : 'bg-surface-secondary text-foreground-muted border-dashed border-border-default hover:border-accent-400'
  }`

const SWATCH_CLS = (selected: boolean, inStock: boolean) =>
  `inline-flex items-center gap-2 min-h-[44px] pl-1 pr-3 py-1 rounded-full text-sm font-medium border-2 transition-colors ${
    selected ? 'border-accent-500 text-foreground' : 'border-border-default text-foreground-secondary hover:border-accent-400'
  } ${inStock ? '' : 'opacity-60'}`

const SELECT_CLS =
  'w-full sm:w-auto min-w-[12rem] min-h-[44px] px-3 py-2 rounded-lg border border-border-default bg-surface-elevated text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary-500'

interface OptionItem {
  id: string
  name: string
  inStock: boolean
  image?: string | null
}

/** One row of choices (variants or sub-variants) in the chosen style. */
function OptionChoices({
  items,
  selectedId,
  onSelect,
  style,
  label,
  showAll,
  setShowAll,
}: {
  items: OptionItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  style: VariantPickerStyle
  label: string
  showAll: boolean
  setShowAll: (fn: (s: boolean) => boolean) => void
}) {
  if (style === 'dropdown') {
    return (
      <select aria-label={label} value={selectedId ?? ''} onChange={e => onSelect(e.target.value)} className={SELECT_CLS}>
        {items.map(o => (
          <option key={o.id} value={o.id}>
            {o.name}
            {!o.inStock && ' (Out of Stock)'}
          </option>
        ))}
      </select>
    )
  }
  const selectedHiddenIndex = items.findIndex(o => o.id === selectedId)
  const mustExpand = !showAll && selectedHiddenIndex >= VARIANT_COLLAPSE_LIMIT
  const collapsed = !showAll && !mustExpand && items.length > VARIANT_COLLAPSE_LIMIT
  const visible = collapsed ? items.slice(0, VARIANT_COLLAPSE_LIMIT) : items
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {visible.map(o =>
          style === 'swatches' ? (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelect(o.id)}
              aria-pressed={selectedId === o.id}
              className={SWATCH_CLS(selectedId === o.id, o.inStock)}
            >
              {o.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.image} alt="" className="w-8 h-8 rounded-full object-cover border border-border-default" />
              ) : (
                <span className="w-8 h-8 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center text-xs font-semibold">
                  {o.name.slice(0, 2)}
                </span>
              )}
              {o.name}
              {!o.inStock && <span className="sr-only"> (Out of Stock)</span>}
            </button>
          ) : (
            <button key={o.id} type="button" onClick={() => onSelect(o.id)} className={OPTION_CLS(selectedId === o.id, o.inStock)}>
              {o.name}
              {!o.inStock && ' (Out of Stock)'}
            </button>
          )
        )}
      </div>
      {items.length > VARIANT_COLLAPSE_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll(s => !s)}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-600 dark:text-accent-400 hover:text-accent-700 transition-colors"
        >
          {showAll ? 'Show fewer' : `Show all ${items.length} options`}
          <svg
            className={`w-4 h-4 transition-transform ${showAll ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
    </>
  )
}

/** The buy-by modes, variants and sub-variants; nothing for a product without variants. */
export function PurchaseOptions({ s, style = 'buttons' }: { s: ProductPurchase; style?: VariantPickerStyle }) {
  if (!s.hasVariants) return null
  const { variants, variantType, selectedMode, selectedVariant } = s
  const typeLabel = variants.find(v => v.variant_type)?.variant_type || variantType || 'Variant'
  const label = s.hasMultipleModes
    ? selectedMode === 'unit'
      ? `Select ${typeLabel}`
      : `Select ${selectedMode === 'weight' ? 'Weight' : 'Length'}`
    : `Select ${typeLabel}`
  const subs = selectedVariant?.sub_variants ?? []
  return (
    <div id={PDP_OPTIONS_ID} className="space-y-3">
      {s.hasMultipleModes && (
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-2">Buy by</label>
          <div className="flex flex-wrap gap-2">
            {s.pricingTypes.map(pt => (
              <button
                key={pt}
                type="button"
                onClick={() => s.setSelectedMode(pt)}
                className={`min-h-11 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
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
        <label className="block text-sm font-medium text-foreground-secondary mb-2">{label}</label>
        <OptionChoices
          items={s.modeVariants.map(v => ({
            id: v.id,
            name: v.variant_name,
            inStock: v.stock_status !== 'Out of Stock',
            image: v.variant_images?.[0]?.thumbnail_url || v.variant_images?.[0]?.image_url || null,
          }))}
          selectedId={s.selectedVariantId}
          onSelect={s.setSelectedVariantId}
          style={style}
          label={label}
          showAll={s.showAllVariants}
          setShowAll={s.setShowAllVariants}
        />
      </div>

      {subs.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-2">
            Select {selectedVariant!.sub_variant_type || 'Sub-Variant'}
          </label>
          <OptionChoices
            items={subs.map(sv => ({ id: sv.id, name: sv.sub_variant_name, inStock: sv.stock_status !== 'Out of Stock' }))}
            selectedId={s.selectedSubVariantId}
            onSelect={s.setSelectedSubVariantId}
            style={style}
            label={`Select ${selectedVariant!.sub_variant_type || 'Sub-Variant'}`}
            showAll={s.showAllSubVariants}
            setShowAll={s.setShowAllSubVariants}
          />
        </div>
      )}
    </div>
  )
}

const rs = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The live price for the selection; `compact` is the price line alone, without the total and savings. */
export function PurchasePrice({ s, compact = false }: { s: ProductPurchase; compact?: boolean }) {
  const { effectivePrice, effectiveMrp, effectiveUnitLabel, unitFactor, quantity, mrpDiscount } = s
  const priceLine = (
    <div className={compact ? 'flex items-baseline gap-2 flex-wrap' : 'flex items-baseline gap-2 flex-wrap mb-1'}>
      <span className="text-4xl font-bold text-primary-600 dark:text-primary-400">Rs. {rs(effectivePrice)}</span>
      {s.showPerUnit && (
        <span className="text-sm text-foreground-secondary">
          / <UnitLabel label={s.perUnitLabel} />
        </span>
      )}
      {effectiveMrp && effectiveMrp > effectivePrice && (
        <span className="text-xl text-foreground-muted line-through">Rs. {rs(effectiveMrp)}</span>
      )}
      {compact && mrpDiscount > 0 && (
        <span className="bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 px-3 py-1 rounded-full text-sm font-semibold">
          {mrpDiscount}% off
        </span>
      )}
    </div>
  )
  if (compact) return priceLine
  return (
    <div className="bg-surface rounded-lg p-6">
      {/* Big orange = base unit price (per m, per kg, per pc etc.) */}
      {priceLine}
      {/* Selling unit price (e.g. per pair/box) on its own line */}
      {s.showPerBasePrice && (
        <div className="mb-1">
          <span className="text-base font-semibold text-foreground">
            Rs.{' '}
            {(effectivePrice * unitFactor).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            / <UnitLabel label={effectiveUnitLabel} />
          </span>
          <span className="text-xs text-foreground-muted ml-2">
            (1 <UnitLabel label={effectiveUnitLabel} /> = {unitFactor}{' '}
            <UnitLabel label={s.baseUnitLabel ?? effectiveUnitLabel} /> × Rs.{' '}
            {rs(effectivePrice)})
          </span>
        </div>
      )}

      {/* Total = selling unit price × qty */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-foreground-secondary">
          Total ({quantity} <UnitLabel label={effectiveUnitLabel} />
          ):
        </span>
        <span className="text-base font-semibold text-foreground">
          Rs.{' '}
          {(effectivePrice * unitFactor * quantity).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>

      {mrpDiscount > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <span className="bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 px-3 py-1 rounded-full text-sm font-semibold">
            {mrpDiscount}% off
          </span>
          <span className="text-sm text-foreground-secondary">
            You save Rs.{' '}
            {((effectiveMrp! - effectivePrice) * unitFactor * quantity).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      )}
      {s.gstEnabled && (
        <p className="text-xs text-foreground-muted">
          Inclusive of all taxes{s.gstPercentage ? ` (${s.gstPercentage}% GST)` : ''}
        </p>
      )}
    </div>
  )
}

/** Stock, delivery date and the quantity input for the selection. */
export function PurchaseQuantity({ s, stock = true }: { s: ProductPurchase; stock?: boolean }) {
  const { effectiveStock, effectiveUnitLabel, effectiveUnitKey, edd, user, selectedPin, addresses } = s
  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-2">
        <label className="text-sm font-medium text-foreground-secondary">
          Quantity
          {effectiveUnitLabel && effectiveUnitKey !== 'unit' ? (
            <>
              {' '}
              (<UnitLabel label={effectiveUnitLabel} />)
            </>
          ) : (
            ''
          )}
        </label>
        {stock && (
          <div className="text-right">
            {effectiveStock > 0 ? (
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-green-700 dark:text-green-400 font-semibold">In Stock</span>
                </div>
                {s.isCodAllowed && (
                  <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    COD
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-red-700 dark:text-red-400 font-semibold">Out of Stock</span>
              </div>
            )}
            {edd && effectiveStock > 0 && (
              <div className="relative">
                <p className="text-xs text-foreground-secondary whitespace-nowrap">
                  Deliver by{' '}
                  <span className="font-medium text-foreground">
                    {new Date(edd + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                  {user && selectedPin && (
                    <>
                      {' '}
                      · <span className="font-medium">{selectedPin}</span>
                      {addresses.length > 0 && (
                        <button
                          type="button"
                          onClick={() => s.setShowAddressPicker(v => !v)}
                          className="ml-1 text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:no-underline"
                        >
                          Change
                        </button>
                      )}
                    </>
                  )}
                </p>
                {s.showAddressPicker && (
                  <div
                    ref={s.addressPickerRef}
                    className="absolute right-0 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg z-10 py-1"
                  >
                    {addresses.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => s.pickAddress(a.postal_code)}
                        className="w-full text-left px-3 py-2 hover:bg-surface-hover text-xs"
                      >
                        <span className="font-medium block">{a.full_name}</span>
                        <span className="text-foreground-secondary">
                          {a.city}, {a.state} – {a.postal_code}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {!s.subscribing && !s.digital && (
        <QuantityInput
          dimension={s.sellUnit?.dimension ?? 'count'}
          quantity={s.quantity}
          quantityRaw={s.quantityRaw}
          unitLabel={effectiveUnitLabel}
          unitKey={effectiveUnitKey}
          effectiveStock={effectiveStock}
          qtyStep={s.qtyStep}
          qtyMin={s.qtyMin}
          qtyMax={s.qtyMax}
          onChange={(qty, raw) => {
            s.setQuantity(qty)
            s.setQuantityRaw(raw)
          }}
        />
      )}
      {!s.subscribing && !s.digital && <InCartQtyHint cap={s.cartCap} unitLabel={effectiveUnitLabel} adding={s.quantity} />}
    </div>
  )
}

/** Coming-soon and discontinued notices. */
export function PurchaseNotices({ s }: { s: ProductPurchase }) {
  return (
    <>
      {s.isPreLaunch && s.launchDate && (
        <div className="text-sm text-amber-600 dark:text-amber-400 font-medium py-2 px-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
          Coming Soon — Available from{' '}
          {new Date(s.launchDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      )}
      {s.isDiscontinued && (
        <div className="text-sm text-gray-500 dark:text-gray-400 font-medium py-2 px-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
          This product has been discontinued
        </div>
      )}
    </>
  )
}

/** Buy once / subscribe, for subscription products. */
export function PurchaseSubscribe({ s }: { s: ProductPurchase }) {
  if (s.alreadyOwned) return null
  const { selectedVariant } = s
  return (
    <SubscribeOption
      productId={s.productId}
      variantId={s.selectedVariantId}
      subVariantId={s.selectedSubVariantId}
      isSubscription={s.isSubscription}
      intervals={s.subscriptionIntervals}
      digital={s.digital}
      mode={s.purchaseMode}
      onModeChange={s.setPurchaseMode}
      disabled={!s.is_active || s.isPreLaunch || s.isDiscontinued}
      needsChoice={
        s.hasVariants && !selectedVariant
          ? 'Select an option to see the subscription price.'
          : !!selectedVariant?.sub_variants?.length && !s.selectedSubVariantId
            ? `Select a ${selectedVariant.sub_variant_type || 'sub-variant'} to see the subscription price.`
            : null
      }
    />
  )
}

const BUY_CLS =
  'w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] hover:shadow-lg'
const ADD_CLS =
  'w-full bg-primary-600 hover:bg-primary-700 text-white px-6 py-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] hover:shadow-lg'
const CART_PATH =
  'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'

export function BuyNowButton({ s, label = 'Buy Now' }: { s: ProductPurchase; label?: string }) {
  return (
    <button
      onClick={s.handleBuyNow}
      disabled={!s.is_active || s.effectiveStock === 0 || s.isBuyingNow || s.isPreLaunch || s.isDiscontinued}
      className={BUY_CLS}
    >
      {s.isBuyingNow ? (
        <>
          <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
          Processing...
        </>
      ) : (
        <>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          {label}
        </>
      )}
    </button>
  )
}

export function AddToCartButton({ s, label = 'Add to Cart' }: { s: ProductPurchase; label?: string }) {
  return (
    <button
      onClick={e => s.handleAddToCart(e.currentTarget)}
      disabled={!s.is_active || s.effectiveStock === 0 || s.isAddingToCart || s.isPreLaunch || s.isDiscontinued || s.addBlocked}
      className={ADD_CLS}
    >
      {s.isAddingToCart ? (
        <>
          <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
          Adding...
        </>
      ) : (
        <>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CART_PATH} />
          </svg>
          {s.cartCap.full ? 'Max quantity already in cart' : label}
        </>
      )}
    </button>
  )
}

export function ViewCartLink() {
  return (
    <a
      href="/cart"
      className="w-full border border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 px-6 py-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CART_PATH} />
      </svg>
      View cart
    </a>
  )
}

/**
 * The buy buttons (the sticky bar watches this box). `buyNow: 'digital'` shows Buy Now only for digital products,
 * where it replaces Add to Cart; a separate Buy Now part covers the rest.
 */
export function PurchaseButtons({
  s,
  buyNow = true,
  viewCart = true,
  addLabel,
  buyLabel,
}: {
  s: ProductPurchase
  buyNow?: boolean | 'digital'
  viewCart?: boolean
  addLabel?: string
  buyLabel?: string
}) {
  const showBuy = buyNow === 'digital' ? s.digital : buyNow
  return (
    <div id={PDP_BUY_BUTTONS_ID} className="space-y-3">
      {s.subscribing && !s.alreadyOwned ? null : s.alreadyOwned ? (
        <a
          href={s.vaultUrl || '/api/vault/handoff'}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full bg-primary-600 hover:bg-primary-700 text-white px-6 py-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          Open in vault
        </a>
      ) : (
        <>
          {showBuy && <BuyNowButton s={s} label={buyLabel} />}
          {!s.digital && <AddToCartButton s={s} label={addLabel} />}
          {viewCart && s.inCart && !s.digital && <ViewCartLink />}
        </>
      )}
    </div>
  )
}

/** The slim bottom bar shown once the buy buttons scroll away. */
export function PurchaseStickyBar({ s }: { s: ProductPurchase }) {
  const { selectedVariant, digital } = s
  return (
    <StickyAddToCartBar
      name={s.productName}
      image={selectedVariant?.variant_images?.[0]?.thumbnail_url || s.stickyImage}
      quantity={s.quantity}
      adding={digital ? s.isBuyingNow : s.isAddingToCart}
      onAdd={digital ? s.handleBuyNow : s.handleAddToCart}
      buyNow={digital}
      price={s.effectivePrice}
      mrp={s.effectiveMrp}
      unitLabel={s.showPerUnit ? s.perUnitLabel : null}
      action={stickyBarAction({
        purchasable: s.is_active && !s.isPreLaunch && !s.isDiscontinued && !(digital && s.alreadyOwned),
        hasVariants: s.hasVariants,
        variants: s.variants,
        selectionInStock: s.effectiveStock > 0,
        needsChoice: !selectedVariant || (!!selectedVariant.sub_variants?.length && !s.selectedSubVariantId),
      })}
    />
  )
}

/** The product page's purchase column: options, price, quantity and the buy buttons. */
export default function ProductActions({ s }: { s: ProductPurchase }) {
  return (
    <div className="space-y-4">
      <PurchaseOptions s={s} />
      <PurchasePrice s={s} />
      <PurchaseQuantity s={s} />
      <PurchaseNotices s={s} />
      <PurchaseSubscribe s={s} />
      <PurchaseButtons s={s} />
      <PurchaseStickyBar s={s} />
    </div>
  )
}

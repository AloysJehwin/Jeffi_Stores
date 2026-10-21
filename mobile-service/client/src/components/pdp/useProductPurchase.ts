import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCart } from '../../api/cart'
import { addPdpToCart, startBuyNow, type CartLine, type PdpProduct, type PdpVariant } from '../../api/pdp'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../stores/toastStore'
import { num, pickUnitPrice, round2, stickyBarAction } from './pdp'
import { trackAddToCart, trackViewItem } from '../../lib/analytics'

// State and pricing of the web's ProductActions, lifted into a hook so the sticky bar can live outside the scroll view.

const EPS = 1e-6
const GENERIC_UNITS = new Set(['unit', 'units', 'pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'each'])

function getPerUnitRate(price: number, numeric: number, unit: string): string {
  if (!price || !numeric) return ''
  let rate = price / numeric
  let label = `/${unit}`
  if (unit === 'g') {
    rate = (price / numeric) * 100
    label = '/100g'
  }
  return `₹${rate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${label}`
}

// lib/catalog/cart-unit-cap
function remainingUnitQty(maxQty: number | null | undefined, inCart: number): number | undefined {
  if (maxQty == null || !Number.isFinite(Number(maxQty))) return undefined
  const left = Number(maxQty) - (Number(inCart) || 0)
  return left > EPS ? Number(left.toFixed(6)) : 0
}

const fmt6 = (n: number) => String(Number(n.toFixed(6)))

export function unitCapError(maxQty: number | null | undefined, inCart: number, adding: number): string | null {
  const left = remainingUnitQty(maxQty, inCart)
  if (left === undefined || adding <= left + EPS) return null
  if (left <= 0) return `Max quantity already in cart (max ${fmt6(Number(maxQty))})`
  return `You can add up to ${fmt6(left)} more — ${fmt6(inCart)} already in your cart (max ${fmt6(Number(maxQty))})`
}

export interface PickerQtyCap {
  inCart: number
  min: number
  max: number | undefined
  full: boolean
}

function pickerQtyCap(maxQty: number | null | undefined, inCart: number, minQty = 1): PickerQtyCap {
  const left = remainingUnitQty(maxQty, inCart)
  const full = left !== undefined && left <= 0
  const min = inCart > 0 && left !== undefined && !full ? Math.min(minQty, left) : minQty
  return { inCart, min, max: left, full }
}

function inCartQuantity(items: CartLine[], key: { productId: string; variantId: string | null; subVariantId: string | null; buyMode: string }) {
  return items
    .filter(
      ci =>
        ci.product_id === key.productId &&
        (ci.variant_id ?? null) === (key.variantId ?? null) &&
        (ci.sub_variant_id ?? null) === (key.subVariantId ?? null) &&
        (ci.buy_mode || 'unit') === (key.buyMode || 'unit')
    )
    .reduce((sum, ci) => sum + (Number(ci.quantity) || 0), 0)
}

export const MODE_LABELS: Record<string, string> = { unit: 'By Piece' }

export function useProductPurchase(
  product: PdpProduct,
  opts: { gstEnabled: boolean; digital: boolean; alreadyOwned: boolean; initialSku?: string }
) {
  const { gstEnabled, digital, alreadyOwned, initialSku } = opts
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)

  const hasVariantsFlag = product.has_variants && (product.product_variants?.length ?? 0) > 0
  const variants: PdpVariant[] = hasVariantsFlag ? product.product_variants : []
  const sku = product.sku
  const stockStatus = product.stock_status
  const basePrice = pickUnitPrice({ inclusive: product.base_price, exGst: product.price_ex_gst }, gstEnabled)
  const basePriceExGst = num(product.price_ex_gst)
  const mrp = num(product.mrp)
  const gstPercentage = product.gst_percentage ? Number(product.gst_percentage) : null
  const discountPct = product.discount_pct != null ? Number(product.discount_pct) : null
  const variantType = product.variant_type || 'Variant'

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isPreLaunch = !!product.launch_date && new Date(product.launch_date) > today
  const isDiscontinued = !!product.discontinue_date && new Date(product.discontinue_date) <= today
  const isActive = true

  const { data: cart } = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: !!user })
  const cartItems: CartLine[] = user ? (cart?.items ?? []) : []

  const [isAddingToCart, setIsAddingToCart] = useState(false)
  const [isBuyingNow, setIsBuyingNow] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [quantityRaw, setQuantityRaw] = useState('1')

  const pricingTypes = Array.from(new Set(variants.map(v => v.pricing_type || 'unit')))
  const hasMultipleModes = pricingTypes.length > 1

  const [selectedMode, setSelectedMode] = useState<string>(() => {
    if (variants.length === 0) return 'unit'
    if (initialSku) {
      const vm = variants.find(v => v.sku === initialSku)
      if (vm) return vm.pricing_type || 'unit'
      const sm = variants.find(v => v.sub_variants?.some(sv => sv.sku === initialSku))
      if (sm) return sm.pricing_type || 'unit'
    }
    return pricingTypes[0] || 'unit'
  })

  const modeVariants = variants.filter(v => (v.pricing_type || 'unit') === selectedMode)

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(() => {
    if (variants.length === 0) return null
    if (initialSku) {
      const vm = variants.find(v => v.sku === initialSku)
      if (vm) return vm.id
      const sm = variants.find(v => v.sub_variants?.some(sv => sv.sku === initialSku))
      if (sm) return sm.id
    }
    return modeVariants[0]?.id ?? variants[0].id
  })
  const [selectedSubVariantId, setSelectedSubVariantId] = useState<string | null>(() => {
    if (initialSku) {
      for (const v of variants) {
        const sv = v.sub_variants?.find(s => s.sku === initialSku)
        if (sv) return sv.id
      }
    }
    const initialVariant =
      variants.find(v => !!initialSku && v.sku === initialSku) ||
      variants.filter(v => (v.pricing_type || 'unit') === (variants[0]?.pricing_type || 'unit'))[0] ||
      variants[0]
    const subs = initialVariant?.sub_variants || []
    if (subs.length > 0) {
      const first = subs.find(s => s.is_active && s.stock_status !== 'Out of Stock') || subs.find(s => s.is_active) || subs[0]
      return first?.id ?? null
    }
    return null
  })

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

  const subInitDone = useRef(false)
  useEffect(() => {
    if (!subInitDone.current) {
      subInitDone.current = true
      return
    }
    const subs = variants.find(x => x.id === selectedVariantId)?.sub_variants || []
    if (subs.length > 0) {
      if (!subs.find(s => s.id === selectedSubVariantId)) {
        const first = subs.find(s => s.is_active && s.stock_status !== 'Out of Stock') || subs.find(s => s.is_active) || subs[0]
        setSelectedSubVariantId(first?.id ?? null)
      }
    } else {
      setSelectedSubVariantId(null)
    }
  }, [selectedVariantId])

  const selectedSubVariant = selectedVariant?.sub_variants?.find(sv => sv.id === selectedSubVariantId) ?? null
  const subVariantType = selectedVariant?.sub_variant_type || product.sub_variant_type || null

  const productInCart = cartItems.some(ci => ci.product_id === product.id)
  const exactInCart = cartItems.some(
    ci =>
      ci.product_id === product.id &&
      (ci.variant_id ?? null) === (selectedVariantId ?? null) &&
      (ci.sub_variant_id ?? null) === (selectedSubVariantId ?? null)
  )
  const inCart = exactInCart || productInCart
  const displaySku = hasVariants && selectedVariant ? selectedSubVariant?.sku || selectedVariant.sku : sku

  const gstMultiplier = 1 + (gstPercentage ?? 0) / 100
  const toInclGst = (ex: number) => round2(ex * gstMultiplier)
  const toExGst = (incl: number) => (gstMultiplier > 0 ? round2(incl / gstMultiplier) : incl)
  const discFactor = 1 - (discountPct ?? 0) / 100

  // Sale price = MRP × (1 − discount_pct) when the product carries a discount, in the GST basis shown.
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
          const fromMrp = priceFromMrp(num(selectedSubVariant.mrp), null)
          if (fromMrp != null) return fromMrp
          if (!gstEnabled) return round2(pickUnitPrice({ inclusive: selectedSubVariant.price, exGst: selectedSubVariant.price_ex_gst }, false))
          if (selectedSubVariant.price != null) return round2(Number(selectedSubVariant.price))
          if (selectedSubVariant.price_ex_gst != null) return toInclGst(Number(selectedSubVariant.price_ex_gst))
        }
        if (selectedVariant) {
          const fromMrp = priceFromMrp(num(selectedVariant.mrp), num(selectedVariant.mrp_ex_gst))
          if (fromMrp != null) return fromMrp
          if (!gstEnabled) return round2(pickUnitPrice({ inclusive: selectedVariant.price, exGst: selectedVariant.price_ex_gst }, false))
          if (selectedVariant.price != null) return round2(Number(selectedVariant.price))
        }
        return round2(pickUnitPrice({ inclusive: basePrice, exGst: basePriceExGst }, gstEnabled))
      })()
    : (() => {
        const fromMrp = priceFromMrp(mrp, null)
        if (fromMrp != null) return fromMrp
        return round2(pickUnitPrice({ inclusive: basePrice, exGst: basePriceExGst }, gstEnabled))
      })()
  const effectiveMrpRaw = hasVariants
    ? selectedSubVariant?.mrp != null
      ? Number(selectedSubVariant.mrp)
      : selectedVariant?.mrp != null
        ? Number(selectedVariant.mrp)
        : mrp
    : mrp
  const effectiveMrp =
    !gstEnabled && effectiveMrpRaw != null && gstMultiplier > 0 ? round2(Number(effectiveMrpRaw) / gstMultiplier) : effectiveMrpRaw
  const effectiveStock = hasVariants
    ? (selectedSubVariant ? selectedSubVariant.stock_status : selectedVariant?.stock_status) !== 'Out of Stock'
      ? 9999
      : 0
    : stockStatus !== 'Out of Stock'
      ? 9999
      : 0
  const mrpDiscount = effectiveMrp && effectiveMrp > effectivePrice ? Math.round(((effectiveMrp - effectivePrice) / effectiveMrp) * 100) : 0
  const perUnitRate =
    selectedVariant?.pricing_type && selectedVariant.pricing_type !== 'unit' && selectedVariant.numeric_value && selectedVariant.unit
      ? getPerUnitRate(effectivePrice, Number(selectedVariant.numeric_value), selectedVariant.unit)
      : null

  // Selling unit: most specific grain first (sub-variant, variant pointer/row, product pointer/row).
  const productUnits = digital ? [] : (product.product_units ?? [])
  const sellUnitId = product.sell_unit_id ?? null
  const variantSellUnitId = selectedVariant?.sell_unit_id ?? null
  const sellUnit = (() => {
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
    if (sellUnitId) {
      const u = productUnits.find(u => u.id === sellUnitId)
      if (u) return u
    }
    return productUnits.find(u => u.variant_id === null && u.sub_variant_id === null && u.is_base) ?? productUnits[0] ?? null
  })()
  const effectiveUnitKey = sellUnit?.unit ?? 'unit'
  const effectiveUnitLabel = sellUnit?.display_label ?? sellUnit?.unit ?? null
  const dimension = sellUnit?.dimension ?? 'count'
  const isContinuous = dimension === 'length' || dimension === 'weight' || dimension === 'area' || dimension === 'volume'
  const unitFactor = sellUnit?.factor != null ? Number(sellUnit.factor) : 1
  const baseUnit = (() => {
    const variantUnits = selectedVariantId ? productUnits.filter(u => u.variant_id === selectedVariantId) : []
    const productLevel = productUnits.filter(u => u.variant_id === null)
    const pool = variantUnits.length > 0 ? variantUnits : productLevel
    return pool.find(u => Number(u.factor) === 1 && u.unit !== (sellUnit?.unit ?? '')) ?? null
  })()
  const baseUnitLabel = baseUnit?.display_label ?? baseUnit?.unit ?? (unitFactor !== 1 && dimension === 'count' ? 'pc' : null)
  const showPerBasePrice = unitFactor !== 1
  const perUnitLabel = showPerBasePrice ? (baseUnitLabel ?? effectiveUnitLabel) : effectiveUnitLabel
  const showPerUnit = !!perUnitLabel && !GENERIC_UNITS.has(String(perUnitLabel).trim().toLowerCase())
  const qtyStep = dimension === 'count' ? 1 : sellUnit?.qty_step != null ? Number(sellUnit.qty_step) : isContinuous ? 0.001 : 1
  const qtyMin = sellUnit?.min_qty != null ? Number(sellUnit.min_qty) : 1
  const qtyMax = sellUnit?.max_qty != null ? Number(sellUnit.max_qty) : undefined
  const cartCap = pickerQtyCap(
    qtyMax,
    inCartQuantity(cartItems, { productId: product.id, variantId: selectedVariantId, subVariantId: selectedSubVariantId, buyMode: effectiveUnitKey }),
    qtyMin
  )
  const addBlocked = cartCap.full || (cartCap.max != null && quantity > cartCap.max)

  useEffect(() => {
    setQuantity(qtyMin)
    setQuantityRaw(String(qtyMin))
  }, [selectedVariantId])

  useEffect(() => {
    setQuantity(qtyMin)
    setQuantityRaw(isContinuous ? Number(qtyMin.toFixed(6)).toString() : String(qtyMin))
  }, [effectiveUnitKey])

  const optionName = selectedSubVariant?.sub_variant_name || selectedVariant?.variant_name || null
  const viewedSku = useRef<string | null>(null)
  useEffect(() => {
    if (!displaySku || viewedSku.current === displaySku) return
    viewedSku.current = displaySku
    trackViewItem({ sku: displaySku, name: product.name, price: effectivePrice, variant: optionName })
  }, [displaySku, product.name, effectivePrice, optionName])

  const needsSub = !!selectedVariant?.sub_variants?.length && !selectedSubVariantId

  const handleAddToCart = async () => {
    if (!user) return router.push('/(auth)/login')
    if (addBlocked) {
      showToast(unitCapError(qtyMax, cartCap.inCart, quantity) ?? 'Max quantity already in cart', 'error')
      return
    }
    if (needsSub) {
      showToast(`Please select a ${subVariantType || 'sub-variant'}`, 'error')
      return
    }
    setIsAddingToCart(true)
    try {
      await addPdpToCart({
        productId: product.id,
        quantity,
        variantId: selectedVariantId,
        buyMode: effectiveUnitKey,
        buyUnit: effectiveUnitKey,
        subVariantId: selectedSubVariantId,
      })
      qc.invalidateQueries({ queryKey: ['cart'] })
      trackAddToCart({ sku: displaySku, name: product.name, price: effectivePrice, quantity, variant: optionName })
      showToast('Item added to cart!', 'success')
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Failed to add to cart', 'error')
    } finally {
      setIsAddingToCart(false)
    }
  }

  const handleBuyNow = async () => {
    if (!user) return router.push('/(auth)/login')
    if (needsSub) {
      showToast(`Please select a ${subVariantType || 'sub-variant'}`, 'error')
      return
    }
    setIsBuyingNow(true)
    const r = await startBuyNow({
      productId: product.id,
      variantId: selectedVariantId,
      subVariantId: selectedSubVariantId,
      qty: quantity,
      buyMode: effectiveUnitKey,
      buyUnit: effectiveUnitKey,
    })
    setIsBuyingNow(false)
    if (!r.ok) {
      showToast(r.error, 'error')
      return
    }
    router.push({ pathname: '/checkout/review', params: { intent: r.intent } })
  }

  const stickyAction = stickyBarAction({
    purchasable: isActive && !isPreLaunch && !isDiscontinued && !(digital && alreadyOwned),
    hasVariants,
    variants,
    selectionInStock: effectiveStock > 0,
    needsChoice: !selectedVariant || needsSub,
  })

  return {
    variants,
    hasVariants,
    hasMultipleModes,
    pricingTypes,
    selectedMode,
    setSelectedMode,
    modeVariants,
    variantType,
    selectedVariant,
    selectedVariantId,
    setSelectedVariantId,
    selectedSubVariant,
    selectedSubVariantId,
    setSelectedSubVariantId,
    subVariantType,
    displaySku,
    inCart,
    effectivePrice,
    effectiveMrp,
    effectiveStock,
    mrpDiscount,
    perUnitRate,
    gstPercentage,
    effectiveUnitKey,
    effectiveUnitLabel,
    dimension,
    unitFactor,
    baseUnitLabel,
    showPerBasePrice,
    perUnitLabel,
    showPerUnit,
    qtyStep,
    qtyMin,
    qtyMax,
    cartCap,
    addBlocked,
    quantity,
    quantityRaw,
    setQty: (qty: number, raw: string) => {
      setQuantity(qty)
      setQuantityRaw(raw)
    },
    isPreLaunch,
    isDiscontinued,
    isActive,
    isAddingToCart,
    isBuyingNow,
    handleAddToCart,
    handleBuyNow,
    stickyAction,
  }
}

export type ProductPurchase = ReturnType<typeof useProductPurchase>

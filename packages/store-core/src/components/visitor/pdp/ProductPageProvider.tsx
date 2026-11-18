'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { resolveMedia, type MediaScope, type ProductMediaItem } from '@/lib/catalog/product-media-shared'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useWishlist } from '@/contexts/WishlistContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { digitalActive } from '@/lib/catalog/digital'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { resolveReturnPolicy } from '@/lib/catalog/return-policy-rules'
import type { ReviewSummary } from '@/lib/shared/review-summary-types'
import { useProductPurchase, type ProductPurchase } from '../ProductActions'

export interface ProductImage {
  id: string
  image_url: string
  thumbnail_url: string
  is_primary: boolean
  display_order?: number
  blurhash?: string | null
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
  sub_variant_type?: string | null
  sell_unit_id?: string | null
  variant_images?: ProductImage[]
  sub_variants?: SubVariant[]
}

/** The product as the product page loads it (products/[slug]/page.tsx). */
export interface PdpProduct {
  id: string
  name: string
  sku: string
  slug: string
  description?: string | null
  base_price: number
  mrp?: number | null
  price_ex_gst?: number | null
  gst_percentage?: number | null
  stock_status: string
  has_variants: boolean
  variant_type?: string | null
  discount_pct?: number | null
  extra_delivery_days?: number | null
  handling_days?: number | null
  weight?: number | null
  dimensions?: string | null
  material?: string | null
  finish?: string | null
  size?: string | null
  hsn_code?: string | null
  return_window_days?: number | null
  mpn?: string | null
  gtin?: string | null
  weight_grams?: number | null
  length_cm?: number | null
  breadth_cm?: number | null
  height_cm?: number | null
  package_type?: string | null
  brands?: {
    id: string
    name: string
    slug: string
    return_allowed?: boolean
    return_window_days?: number
    replacement_allowed?: boolean
    replacement_window_days?: number
  } | null
  categories?: {
    id: string
    name: string
    slug: string
    return_allowed?: boolean
    return_window_days?: number
    replacement_allowed?: boolean
    replacement_window_days?: number
  } | null
  product_images: ProductImage[]
  product_variants: Variant[]
  /** product_media (every scope); when present it drives the gallery, variant switching included. */
  media?: ProductMediaItem[]
  product_units?: Array<{
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
  }>
  sell_unit_id?: string | null
  // Identification & Compliance
  barcode?: string | null
  isbn?: string | null
  asin?: string | null
  brand_part_number?: string | null
  country_of_origin?: string | null
  // Physical Attributes
  color?: string | null
  color_hex?: string | null
  volume_ml?: number | null
  net_weight_grams?: number | null
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  // Certifications & Standards
  certifications?: string[] | null
  compliance_standard?: string | null
  safety_rating?: string | null
  warranty_months?: number | null
  warranty_type?: string | null
  // Condition & Lifecycle
  condition?: string | null
  launch_date?: string | null
  discontinue_date?: string | null
  // Age & Audience
  age_min?: number | null
  age_max?: number | null
  target_gender?: string | null
  target_audience?: string[] | null
  is_cod_allowed?: boolean | null
  is_digital?: boolean | null
  is_subscription?: boolean | null
  subscription_intervals?: string[] | null
  owned_in_vault?: boolean | null
}

export interface PolicyProps {
  returnAllowed: boolean
  returnDays: number
  replacementAllowed: boolean
  replacementDays: number
  isCodAllowed?: boolean
  freeShippingThreshold?: number
}

export interface ProductPageInput {
  product: PdpProduct
  initialSkuParam?: string
  freeShippingThreshold?: number
  reviewSummary?: ReviewSummary | null
}

const asImage = (m: ProductMediaItem): ProductImage => ({
  id: m.id,
  image_url: m.url,
  thumbnail_url: m.thumbnail_url || m.url,
  is_primary: m.is_primary,
  blurhash: m.metadata?.blurhash ?? null,
})

/** Everything the product page's parts share: the product, its media, the purchase selection and the side actions. */
function useProductPageState({ product, initialSkuParam, freeShippingThreshold = 500, reviewSummary = null }: ProductPageInput) {
  const [variantImages, setVariantImages] = useState<ProductImage[] | undefined>(undefined)
  const [mediaSel, setMediaSel] = useState<MediaScope>({})
  const media = useMemo(() => product.media ?? [], [product.media])
  // Product-scope images, and the selection's own (sub-variant → variant) when it has any.
  const mediaImages = useMemo(() => resolveMedia(media, {}).filter(m => m.kind === 'image').map(asImage), [media])
  const selected = useMemo(() => resolveMedia(media, mediaSel), [media, mediaSel])
  const selImageKey = selected.filter(m => m.kind === 'image').map(m => m.id).join(',')
  const selImages = useMemo(
    () => (mediaSel.variantId && selImageKey !== mediaImages.map(i => i.id).join(',') ? selected.filter(m => m.kind === 'image').map(asImage) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selImageKey]
  )
  const extras = selected.filter(m => m.kind !== 'image' && m.kind !== 'document')
  const docs = selected.filter(m => m.kind === 'document')
  const { has: inWishlist, toggle: toggleWishlist } = useWishlist()
  const isInWishlist = inWishlist(product.id)
  const [wishlistLoading, setWishlistLoading] = useState(false)
  const [pincode, setPincode] = useState('')
  const [pincodeResult, setPincodeResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pincodeChecking, setPincodeChecking] = useState(false)
  const [notifyEmail, setNotifyEmail] = useState('')
  const [notifySubmitted, setNotifySubmitted] = useState(false)
  const pincodeRef = useRef<HTMLInputElement>(null)
  const { user } = useAuth()
  const { showToast, showConfirm } = useToast()
  const gstEnabled = useStoreConfig().flags.gstEnabled
  const digitalMaster = useStoreConfig().flags.digitalProductsEnabled
  const isDigital = digitalActive(digitalMaster, product.is_digital ?? false)
  const router = useRouter()
  const [vaultOwned, setVaultOwned] = useState<{ owned: boolean; url: string | null }>({
    owned: product.owned_in_vault ?? false,
    url: null,
  })

  useEffect(() => {
    if (!isDigital || !user) return
    let cancelled = false
    fetch(`/api/vault/owned?productId=${encodeURIComponent(product.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && d) setVaultOwned({ owned: !!d.owned, url: d.url ?? null })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isDigital, user, product.id])

  useEffect(() => {
    if (user?.email) setNotifyEmail(user.email)
  }, [user])

  const checkPincode = useCallback(async () => {
    const p = pincode.trim()
    if (!/^\d{6}$/.test(p)) {
      setPincodeResult({ ok: false, message: 'Enter a valid 6-digit pincode' })
      return
    }
    setPincodeChecking(true)
    setPincodeResult(null)
    try {
      const res = await fetch(`/api/delivery-check?pincode=${p}`)
      const data = await res.json()
      setPincodeResult({ ok: data.serviceable, message: data.message })
    } catch {
      setPincodeResult({ ok: false, message: 'Could not check delivery. Try again.' })
    } finally {
      setPincodeChecking(false)
    }
  }, [pincode])

  const handleNotifyMe = useCallback(async () => {
    const email = notifyEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Enter a valid email address', 'error')
      return
    }
    try {
      await fetch('/api/notify-back-in-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, email }),
        credentials: 'include',
      })
      setNotifySubmitted(true)
    } catch {
      showToast('Failed to save. Try again.', 'error')
    }
  }, [notifyEmail, product.id])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [product.slug])

  useEffect(() => {
    fetch(`/api/products/${product.id}/view`, { method: 'POST', credentials: 'include' }).catch(() => {})
  }, [product.id])

  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const primaryImage = product.product_images?.find(img => img.is_primary) ?? product.product_images?.[0]
  const displayPrice = pickUnitPrice({ inclusive: product.base_price, exGst: product.price_ex_gst }, gstEnabled)
  const rawMrp = product.mrp ? Number(product.mrp) : null

  // Same rule as order-time returns (lib/catalog/return-policy.ts); the category arrives already
  // falling back to its parent.
  const resolved = resolveReturnPolicy({
    productReturnWindowDays: product.return_window_days,
    brand: product.brands,
    category: product.categories,
  })
  const returnAllowed = resolved.return_allowed
  const replacementAllowed = resolved.replacement_allowed
  const policy: PolicyProps = {
    returnAllowed,
    returnDays: returnAllowed ? resolved.return_window_days : 0,
    replacementAllowed,
    replacementDays: replacementAllowed ? resolved.replacement_window_days : 0,
    isCodAllowed: product.is_cod_allowed ?? false,
    freeShippingThreshold,
  }

  const handleWishlist = useCallback(async () => {
    if (!user) {
      showConfirm({
        title: 'Sign In Required',
        message: 'Please sign in to save items to your wishlist.',
        confirmText: 'Sign In',
        cancelText: 'Maybe Later',
        type: 'info',
        onConfirm: () => router.push(`/login?redirect=/products/${product.slug}`),
      })
      return
    }
    setWishlistLoading(true)
    const result = await toggleWishlist(product.id)
    setWishlistLoading(false)
    if (result === 'added') showToast('Added to wishlist!', 'success')
    else if (result === 'removed') showToast('Removed from wishlist', 'success')
    else showToast('Failed to update wishlist', 'error')
  }, [user, product.id, product.slug, toggleWishlist])

  const handleShare = useCallback(async () => {
    const url = window.location.href
    const shareData = { title: product.name, text: `Check out ${product.name}`, url }
    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {}
    } else {
      await navigator.clipboard.writeText(url)
      showToast('Link copied to clipboard!', 'success')
    }
  }, [product.name])

  const purchase = useProductPurchase({
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    stockStatus: product.stock_status,
    basePrice: displayPrice,
    basePriceExGst: product.price_ex_gst ?? null,
    salePrice: null,
    mrp: rawMrp,
    gstPercentage: product.gst_percentage ? Number(product.gst_percentage) : null,
    variants: hasVariants ? product.product_variants : [],
    variantType: product.variant_type || 'Variant',
    initialSkuParam,
    discountPct: product.discount_pct != null ? Number(product.discount_pct) : null,
    extraDeliveryDays: Number(product.extra_delivery_days ?? 0),
    handlingDays: Number(product.handling_days ?? 2),
    isCodAllowed: product.is_cod_allowed ?? false,
    onVariantChange: variant => setVariantImages(variant?.variant_images && variant.variant_images.length > 0 ? variant.variant_images : undefined),
    onSelectionChange: (variantId, subVariantId) =>
      setMediaSel(cur => (cur.variantId === variantId && cur.subVariantId === subVariantId ? cur : { variantId, subVariantId })),
    productUnits: product.product_units ?? [],
    sellUnitId: product.sell_unit_id ?? null,
    launchDate: product.launch_date ?? null,
    discontinueDate: product.discontinue_date ?? null,
    stickyImage: primaryImage?.thumbnail_url || primaryImage?.image_url || null,
    digital: isDigital,
    alreadyOwned: vaultOwned.owned,
    vaultUrl: vaultOwned.url,
    isSubscription: product.is_subscription ?? false,
    subscriptionIntervals: product.subscription_intervals ?? null,
  })

  return {
    product,
    reviewSummary,
    hasVariants,
    displayPrice,
    isDigital,
    images: mediaImages.length > 0 ? mediaImages : product.product_images || [],
    variantImages: mediaImages.length > 0 ? selImages : variantImages,
    extras,
    docs,
    isInWishlist,
    wishlistLoading,
    handleWishlist,
    handleShare,
    notifyEmail,
    setNotifyEmail,
    notifySubmitted,
    handleNotifyMe,
    pincode,
    setPincode,
    pincodeResult,
    setPincodeResult,
    pincodeChecking,
    checkPincode,
    pincodeRef,
    policy,
    purchase,
  }
}

export type ProductPageState = ReturnType<typeof useProductPageState> & { purchase: ProductPurchase }

const ProductPageContext = createContext<ProductPageState | null>(null)

/** The product page's shared state; parts (gallery, price, variant picker, add to cart…) in any order read it. */
export function ProductPageProvider({ children, ...input }: ProductPageInput & { children: ReactNode }) {
  const state = useProductPageState(input)
  return <ProductPageContext.Provider value={state}>{children}</ProductPageContext.Provider>
}

/** The mounted product page, or null outside one. */
export function useProductPage(): ProductPageState | null {
  return useContext(ProductPageContext)
}

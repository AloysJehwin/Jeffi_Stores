'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import ProductImageGallery from '@/components/visitor/ProductImageGallery'
import ProductActions from '@/components/business/ProductActions'
import RequestQuoteButton from '@/components/business/RequestQuoteButton'
import RazorpayOffers from '@/components/visitor/RazorpayOffers'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { applyDiscount, mrpDiscountPct } from '@/lib/pricing'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'

interface ProductImage {
  id: string
  image_url: string
  thumbnail_url: string
  is_primary: boolean
  display_order?: number
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

interface ProductDetailClientProps {
  product: {
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
    // Age & Audience
    age_min?: number | null
    age_max?: number | null
    target_gender?: string | null
    target_audience?: string[] | null
    is_cod_allowed?: boolean | null
  }
  initialSkuParam?: string
}

interface PolicyProps {
  returnAllowed: boolean
  returnDays: number
  replacementAllowed: boolean
  replacementDays: number
  isCodAllowed?: boolean
}

const DeliveryInfo = ({ returnAllowed, returnDays, replacementAllowed, replacementDays, isCodAllowed }: PolicyProps) => {
  const items = [
    {
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
          <path d="M13 16V5a1 1 0 00-1-1H4a1 1 0 00-1 1v11m10 0h-3M6 16H3m4-7h6l3 5"/>
        </svg>
      ),
      label: 'Free Delivery',
      sub: 'On orders above ₹500',
      color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
      href: '/legal/shipping-policy',
    },
    {
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
      ),
      label: returnAllowed ? 'Easy Returns' : 'Non-Returnable',
      sub: returnAllowed ? `${returnDays}-day return policy` : 'This product cannot be returned',
      color: returnAllowed
        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
        : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',
      href: '/legal/return-refund-policy',
    },
    {
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
        </svg>
      ),
      label: replacementAllowed ? 'Free Replacement' : 'Non-Replaceable',
      sub: replacementAllowed ? `${replacementDays}-day guarantee` : 'This product cannot be replaced',
      color: replacementAllowed
        ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
        : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',
      href: '/legal/return-refund-policy',
    },
    {
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
        </svg>
      ),
      label: '100% Genuine',
      sub: 'Verified authentic products',
      color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
      href: '/legal/warranty-policy',
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 items-stretch">
        {items.map((item, i) => (
          <Link key={i} href={item.href} target="_blank" rel="noopener noreferrer"
            className="flex items-start gap-2.5 p-3 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary hover:border-accent-300 transition-colors group h-full overflow-hidden">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${item.color}`}>
              {item.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground leading-tight group-hover:text-accent-600 transition-colors">{item.label}</p>
              <p className="text-[11px] text-foreground-muted leading-snug mt-0.5">{item.sub}</p>
            </div>
          </Link>
        ))}
      </div>

      <Link href="/legal/faq" target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary hover:border-accent-300 transition-colors group">
        <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <span className="text-[11px] font-medium text-foreground-muted group-hover:text-accent-600 transition-colors w-10 leading-tight shrink-0">Secure Payment</span>
        <div className="flex items-center gap-1 flex-wrap ml-2">
          {['UPI', 'Cards', 'Net Banking', 'Wallets'].map(m => (
            <span key={m} className="text-[9px] font-semibold text-foreground-secondary bg-surface-secondary border border-border-default px-1 py-0.5 rounded whitespace-nowrap">
              {m}
            </span>
          ))}
          {isCodAllowed && (
            <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-1 py-0.5 rounded whitespace-nowrap">
              Cash on Delivery
            </span>
          )}
        </div>
      </Link>
    </div>
  )
}

export default function ProductDetailClient({ product, initialSkuParam }: ProductDetailClientProps) {
  const [variantImages, setVariantImages] = useState<ProductImage[] | undefined>(undefined)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [selectedSubVariantId, setSelectedSubVariantId] = useState<string | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<{ key: string; label: string | null; min: number; max: number | null; step: number; factor: number; dimension: string }>({ key: 'Nos', label: null, min: 1, max: null, step: 1, factor: 1, dimension: 'count' })
  const { user } = useAuth()
  const { showToast } = useToast()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [product.slug])

  useEffect(() => {
    fetch(`/api/products/${product.id}/view`, { method: 'POST', credentials: 'include', headers: { 'X-Auth-Portal': 'business' } }).catch(() => {})
  }, [product.id])

  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const baseDisplayPrice = Number(product.base_price)
  const mrp = product.mrp ? Number(product.mrp) : null

  // Apply per-category business discount
  const categoryId = product.categories?.id
  const businessDiscountPct = (user?.isBusiness && user.approvalStatus === 'approved' && categoryId)
    ? (user.businessDiscountMap?.[categoryId] ?? 0)
    : 0
  const displayPrice = businessDiscountPct > 0
    ? applyDiscount(baseDisplayPrice, businessDiscountPct)
    : baseDisplayPrice

  const mrpDiscount = mrp && mrp > displayPrice
    ? mrpDiscountPct(mrp, displayPrice)
    : 0

  const brand = product.brands
  const cat = product.categories
  const returnAllowed = (brand?.return_allowed === false || cat?.return_allowed === false)
    ? false
    : (brand?.return_allowed ?? cat?.return_allowed ?? true)
  const returnDays = returnAllowed
    ? (brand?.return_allowed === false ? (brand.return_window_days ?? 7) : (cat?.return_window_days ?? brand?.return_window_days ?? 7))
    : 0
  const replacementAllowed = (brand?.replacement_allowed === false || cat?.replacement_allowed === false)
    ? false
    : (brand?.replacement_allowed ?? cat?.replacement_allowed ?? true)
  const replacementDays = replacementAllowed
    ? (brand?.replacement_allowed === false ? (brand.replacement_window_days ?? 7) : (cat?.replacement_window_days ?? brand?.replacement_window_days ?? 7))
    : 0
  const policy: PolicyProps = { returnAllowed, returnDays, replacementAllowed, replacementDays, isCodAllowed: product.is_cod_allowed ?? false }

  const handleShare = useCallback(async () => {
    const url = window.location.href
    const shareData = { title: product.name, text: `Check out ${product.name}`, url }
    if (navigator.share) {
      try { await navigator.share(shareData) } catch {}
    } else {
      await navigator.clipboard.writeText(url)
      showToast('Link copied to clipboard!', 'success')
    }
  }, [product.name])

  const handleVariantChange = (variant: Variant | null) => {
    if (variant?.variant_images && variant.variant_images.length > 0) {
      setVariantImages(variant.variant_images)
    } else {
      setVariantImages(undefined)
    }
  }

  return (
    <>
      {/* Image column — order-1 on mobile, natural on desktop */}
      <div className="order-1 lg:order-none">
        <div className="relative overflow-hidden rounded-xl">
          <ProductImageGallery
            images={product.product_images || []}
            productName={product.name}
            variantImages={variantImages}
            discountPct={businessDiscountPct > 0 ? null : (product.discount_pct != null ? Number(product.discount_pct) : null)}
            ribbonLabel={businessDiscountPct > 0 ? 'Business offer' : undefined}
          />
        </div>

        <div className="hidden lg:block mt-4">
          <DeliveryInfo {...policy} />
        </div>
      </div>

      {/* Product info column — order-2 on mobile, natural on desktop */}
      <div className="order-2 lg:order-none lg:pl-4 min-w-0">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex-1 min-w-0">
            {product.name}
          </h1>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            <button
              onClick={handleShare}
              aria-label="Share product"
              className="w-10 h-10 rounded-full border border-border-secondary bg-surface-elevated hover:bg-surface-secondary flex items-center justify-center text-foreground-secondary hover:text-accent-500 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          </div>
        </div>

        <ProductWarningBadges fragile={product.fragile} hazardous={product.hazardous} flammable={product.flammable} />

        <ProductActions
          productId={product.id}
          productName={product.name}
          sku={product.sku}
          stockStatus={product.stock_status}
          basePrice={displayPrice}
          salePrice={null}
          mrp={mrp}
          gstPercentage={product.gst_percentage ? Number(product.gst_percentage) : null}
          variants={hasVariants ? product.product_variants : []}
          variantType={product.variant_type || 'Variant'}
          initialSkuParam={initialSkuParam}
          discountPct={product.discount_pct != null ? Number(product.discount_pct) : null}
          extraDeliveryDays={Number(product.extra_delivery_days ?? 0)}
          handlingDays={Number(product.handling_days ?? 2)}
          isCodAllowed={product.is_cod_allowed ?? false}
          onVariantChange={handleVariantChange}
          onSelectionChange={(vId, svId) => { setSelectedVariantId(vId); setSelectedSubVariantId(svId) }}
          onUnitChange={(key, label, meta) => setSelectedUnit({ key, label, ...meta })}
          categoryId={categoryId ?? null}
          productUnits={product.product_units ?? []}
          sellUnitId={product.sell_unit_id ?? null}
        />

        {(() => {
          const primaryImage = product.product_images?.find(img => img.is_primary) || product.product_images?.[0]
          const overallStockQty = hasVariants
            ? product.product_variants?.reduce((sum: number, v: any) => sum + (v.stock_status !== 'Out of Stock' ? 1 : 0), 0) ?? 0
            : (product.stock_status !== 'Out of Stock' ? 1 : 0)
          return (
            <RequestQuoteButton
              items={[{
                productId: product.id,
                variantId: selectedVariantId || undefined,
                subVariantId: selectedSubVariantId || undefined,
                description: product.name,
                quantity: 1,
                unit: selectedUnit.key,
                unitMin: selectedUnit.min,
                unitMax: selectedUnit.max ?? undefined,
                unitStep: selectedUnit.step,
                unitFactor: selectedUnit.factor,
                unitDimension: selectedUnit.dimension,
                currentPrice: hasVariants ? null : displayPrice,
                imageUrl: primaryImage?.image_url ?? null,
                brandName: product.brands?.name ?? null,
                categoryName: product.categories?.name ?? null,
                sku: hasVariants ? null : (product.sku || null),
                stockStatus: hasVariants ? null : (overallStockQty > 0 ? 'in' : 'out'),
                variants: hasVariants ? product.product_variants : undefined,
                businessDiscountPct: businessDiscountPct > 0 ? businessDiscountPct : undefined,
              }]}
              className="mt-3 w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg border-2 border-accent-500 text-accent-600 dark:text-accent-400 font-semibold text-sm hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors disabled:opacity-60"
              unitMeta={selectedUnit}
              productUnits={product.product_units ?? []}
            />
          )
        })()}

        <RazorpayOffers />

        {/* Product Specifications — rendered in page.tsx Specifications card */}
      </div>

      <div className="order-3 lg:hidden">
        <DeliveryInfo {...policy} />
      </div>
    </>
  )
}

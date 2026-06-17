'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import ProductImageGallery from '@/components/visitor/ProductImageGallery'

import ProductActions from '@/components/business/ProductActions'
import RequestQuoteButton from '@/components/business/RequestQuoteButton'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { applyDiscount, mrpDiscountPct } from '@/lib/pricing'

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
  sub_variant_type?: string | null
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
    wholeprice_ex_gst?: number | null
    gst_percentage?: number | null
    stock_quantity: number
    has_variants: boolean
    variant_type?: string | null
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
      unit: string
      factor: number
      is_base: boolean
      is_sell_default: boolean
      is_purchase_default: boolean
      display_label: string | null
      dimension: string
    }>
  }
  initialSkuParam?: string
}

interface PolicyProps {
  returnAllowed: boolean
  returnDays: number
  replacementAllowed: boolean
  replacementDays: number
}

const DeliveryInfo = ({ returnAllowed, returnDays, replacementAllowed, replacementDays }: PolicyProps) => {
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
            className="flex items-start gap-2.5 p-3 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary hover:border-accent-300 transition-colors group h-full">
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
        <span className="text-[11px] font-medium text-foreground-muted group-hover:text-accent-600 transition-colors whitespace-nowrap">Secure Payment</span>
        <div className="flex items-center gap-1 ml-auto flex-wrap justify-end">
          {['UPI', 'Cards', 'Net Banking', 'Wallets'].map(m => (
            <span key={m} className="text-[9px] font-semibold text-foreground-secondary bg-surface-secondary border border-border-default px-1 py-0.5 rounded whitespace-nowrap">
              {m}
            </span>
          ))}
        </div>
      </Link>
    </div>
  )
}

export default function ProductDetailClient({ product, initialSkuParam }: ProductDetailClientProps) {
  const [variantImages, setVariantImages] = useState<ProductImage[] | undefined>(undefined)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [selectedSubVariantId, setSelectedSubVariantId] = useState<string | null>(null)
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
  const policy: PolicyProps = { returnAllowed, returnDays, replacementAllowed, replacementDays }

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
        <ProductImageGallery
          images={product.product_images || []}
          productName={product.name}
          variantImages={variantImages}
        />

        <div className="hidden lg:block mt-4">
          <DeliveryInfo {...policy} />
        </div>
      </div>

      {/* Product info column — order-2 on mobile, natural on desktop */}
      <div className="order-2 lg:order-none">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex-1">
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

        {product.brands && (
          <div className="flex items-center gap-4 mb-4 text-sm">
            <span className="text-foreground-secondary">
              Brand: <span className="font-medium text-foreground">{product.brands.name}</span>
            </span>
          </div>
        )}

        {/* Price & Stock — inline for non-variant products */}
        {!hasVariants && (
          <>
            <div className="bg-surface rounded-lg p-4 sm:p-6 mb-6">
              {businessDiscountPct > 0 ? (
                <>
                  <div className="flex items-baseline justify-between gap-2 mb-3">
                    <span className="text-sm text-foreground-secondary shrink-0">Regular price</span>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <span className="text-base text-foreground-muted line-through tabular-nums">
                        Rs.&nbsp;{baseDisplayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                      {mrp && mrp > baseDisplayPrice && (
                        <span className="text-sm text-foreground-muted line-through tabular-nums">
                          MRP Rs.&nbsp;{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mb-1">
                    <p className="text-sm font-semibold text-accent-600 dark:text-accent-400 mb-1">Your business price</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-3xl font-bold text-primary-600 dark:text-primary-400 tabular-nums">
                        Rs.&nbsp;{displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                    Rs.&nbsp;{displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                  {mrp && mrp > displayPrice && (
                    <span className="text-lg text-foreground-muted line-through tabular-nums">
                      Rs.&nbsp;{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              )}
              {mrpDiscount > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 px-3 py-1 rounded-full text-sm font-semibold">
                    {mrpDiscount}% off
                  </span>
                  <span className="text-sm text-foreground-secondary">
                    You save Rs. {(mrp! - displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <p className="text-xs text-foreground-muted">
                Inclusive of all taxes
                {product.gst_percentage ? ` (${parseFloat(String(product.gst_percentage))}% GST)` : ''}
              </p>
              {product.wholeprice_ex_gst && (
                <div className="mt-3 pt-3 border-t border-border-default">
                  <span className="text-sm text-foreground-secondary">
                    Wholesale Price: <span className="font-semibold text-foreground">Rs. {(Number(product.wholeprice_ex_gst) * (1 + (parseFloat(String(product.gst_percentage)) || 0) / 100)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </span>
                </div>
              )}
            </div>

            <div className="mb-6">
              {product.stock_quantity > 0 ? (
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-green-700 dark:text-green-400 font-semibold">
                    In Stock{product.stock_quantity < 10 ? ` (${product.stock_quantity} left)` : ''}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span className="text-red-700 dark:text-red-400 font-semibold">Out of Stock</span>
                </div>
              )}
            </div>
          </>
        )}

        <ProductActions
          productId={product.id}
          productName={product.name}
          sku={product.sku}
          stockQuantity={product.stock_quantity}
          basePrice={displayPrice}
          salePrice={null}
          mrp={mrp}
          gstPercentage={product.gst_percentage ? Number(product.gst_percentage) : null}
          wholesalePrice={product.wholeprice_ex_gst ? Number(product.wholeprice_ex_gst) : null}
          variants={hasVariants ? product.product_variants : []}
          variantType={product.variant_type || 'Variant'}
          initialSkuParam={initialSkuParam}
          onVariantChange={handleVariantChange}
          onSelectionChange={(vId, svId) => { setSelectedVariantId(vId); setSelectedSubVariantId(svId) }}
          categoryId={categoryId ?? null}
          productUnits={product.product_units ?? []}
        />

        {(() => {
          const primaryImage = product.product_images?.find(img => img.is_primary) || product.product_images?.[0]
          const overallStockQty = hasVariants
            ? product.product_variants?.reduce((sum: number, v: any) => sum + Number(v.stock_quantity ?? 0), 0) ?? 0
            : Number(product.stock_quantity ?? 0)
          return (
            <RequestQuoteButton
              items={[{
                productId: product.id,
                variantId: selectedVariantId || undefined,
                subVariantId: selectedSubVariantId || undefined,
                description: product.name,
                quantity: 1,
                unit: 'Nos',
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
            />
          )
        })()}

        {/* Product Specifications */}
        <div className="mt-6 pt-6 border-t border-border-default">
          <h3 className="font-semibold text-foreground mb-3">Product Specifications</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {product.weight && (
              <>
                <dt className="text-foreground-secondary">Weight:</dt>
                <dd className="font-medium text-foreground">{product.weight} kg</dd>
              </>
            )}
            {product.dimensions && (
              <>
                <dt className="text-foreground-secondary">Dimensions:</dt>
                <dd className="font-medium text-foreground">{product.dimensions} cm</dd>
              </>
            )}
            {product.categories && (
              <>
                <dt className="text-foreground-secondary">Category:</dt>
                <dd className="font-medium text-foreground">{product.categories.name}</dd>
              </>
            )}
            {product.brands && (
              <>
                <dt className="text-foreground-secondary">Brand:</dt>
                <dd className="font-medium text-foreground">{product.brands.name}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <div className="order-3 lg:hidden">
        <DeliveryInfo {...policy} />
      </div>
    </>
  )
}

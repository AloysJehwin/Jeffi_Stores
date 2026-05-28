'use client'

import { useState } from 'react'
import Link from 'next/link'
import ProductImageGallery from './ProductImageGallery'
import ProductActions from './ProductActions'

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
    weight_rate?: number | null
    weight_unit?: string | null
    length_rate?: number | null
    length_unit?: string | null
    weight?: number | null
    dimensions?: string | null
    brands?: { id: string; name: string; slug: string } | null
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
  }
  initialSkuParam?: string
}

interface PolicyProps {
  returnAllowed: boolean
  returnDays: number
  replacementAllowed: boolean
  replacementDays: number
}

const DeliveryInfo = ({ returnAllowed, returnDays, replacementAllowed, replacementDays }: PolicyProps) => (
  <>
    <div className="bg-surface rounded-lg border border-border-default p-4">
      <div className="grid grid-cols-1 gap-3">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8M10 12v4m4-4v4" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-foreground">Free Delivery</p>
            <p className="text-xs text-foreground-secondary">On orders above ₹500</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-foreground">{returnAllowed ? 'Easy Returns' : 'No Returns'}</p>
            <p className="text-xs text-foreground-secondary">
              {returnAllowed ? `${returnDays}-day hassle-free return policy` : 'This item is not eligible for returns'}
            </p>
          </div>
        </div>
        {replacementAllowed && (
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-foreground">Replacement Available</p>
            <p className="text-xs text-foreground-secondary">{replacementDays}-day replacement window</p>
          </div>
        </div>
        )}
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-foreground">100% Genuine</p>
            <p className="text-xs text-foreground-secondary">Authentic products guaranteed</p>
          </div>
        </div>
      </div>
    </div>
    <div className="mt-3 bg-surface rounded-lg border border-border-default px-4 py-3">
      <p className="text-xs text-foreground-secondary text-center mb-2">Secure Payment Options</p>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        {['UPI', 'Cards', 'Net Banking', 'Wallets'].map((method) => (
          <span key={method} className="text-xs font-medium bg-surface-elevated border border-border-default text-foreground-secondary px-2 py-1 rounded">
            {method}
          </span>
        ))}
      </div>
    </div>
  </>
)

export default function ProductDetailClient({ product, initialSkuParam }: ProductDetailClientProps) {
  const [variantImages, setVariantImages] = useState<ProductImage[] | undefined>(undefined)

  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const displayPrice = Number(product.base_price)
  const mrp = product.mrp ? Number(product.mrp) : null
  const mrpDiscount = mrp && mrp > displayPrice
    ? Math.round(((mrp - displayPrice) / mrp) * 100)
    : 0

  const handleVariantChange = (variant: Variant | null) => {
    if (variant?.variant_images && variant.variant_images.length > 0) {
      setVariantImages(variant.variant_images)
    } else {
      setVariantImages(undefined)
    }
  }

  const policyProps: PolicyProps = {
    returnAllowed: product.categories?.return_allowed ?? true,
    returnDays: product.categories?.return_window_days ?? 7,
    replacementAllowed: product.categories?.replacement_allowed ?? true,
    replacementDays: product.categories?.replacement_window_days ?? 7,
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

        {/* Delivery & Returns — desktop only (mobile version below as order-3) */}
        <div className="hidden lg:block mt-4">
          <DeliveryInfo {...policyProps} />
        </div>
      </div>

      {/* Product info column — order-2 on mobile, natural on desktop */}
      <div className="order-2 lg:order-none">
        <h1 className="text-3xl font-bold text-foreground mb-4">
          {product.name}
        </h1>

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
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-4xl font-bold text-primary-600 dark:text-primary-400">
                  Rs. {displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                {mrp && mrp > displayPrice && (
                  <span className="text-xl text-foreground-muted line-through">
                    Rs. {mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              {mrpDiscount > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-accent-100 text-accent-700 dark:text-accent-400 px-3 py-1 rounded-full text-sm font-semibold">
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
                    Wholesale Price: <span className="font-semibold text-foreground">Rs. {Number(product.wholeprice_ex_gst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
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
          weightRate={product.weight_rate ? Number(product.weight_rate) : null}
          weightUnit={product.weight_unit || null}
          lengthRate={product.length_rate ? Number(product.length_rate) : null}
          lengthUnit={product.length_unit || null}
          onVariantChange={handleVariantChange}
        />

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

      {/* Delivery & Returns — mobile only (desktop version is inside image column above) */}
      <div className="order-3 lg:hidden">
        <DeliveryInfo {...policyProps} />
      </div>
    </>
  )
}

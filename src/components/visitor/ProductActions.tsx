'use client'

import { useState, useEffect } from 'react'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'

interface Variant {
  id: string
  variant_name: string
  sku: string
  price: number | null
  mrp: number | null
  sale_price: number | null
  wholesale_price: number | null
  stock_quantity: number
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
}

export default function ProductActions({
  productId, productName, sku, stockQuantity,
  basePrice, salePrice, mrp, gstPercentage, wholesalePrice,
  variants, variantType, initialSkuParam,
}: ProductActionsProps) {
  const { addToCart } = useCart()
  const { showToast, showConfirm } = useToast()
  const { user } = useAuth()
  const router = useRouter()
  const [isAddingToCart, setIsAddingToCart] = useState(false)
  const [isBuyingNow, setIsBuyingNow] = useState(false)
  const [isAddingToWishlist, setIsAddingToWishlist] = useState(false)
  const [isInWishlist, setIsInWishlist] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(() => {
    if (variants.length === 0) return null
    if (initialSkuParam) {
      const match = variants.find(v => v.sku === initialSkuParam)
      if (match) return match.id
    }
    return variants[0].id
  })

  const hasVariants = variants.length > 0
  const selectedVariant = variants.find(v => v.id === selectedVariantId)
  const displaySku = hasVariants && selectedVariant ? selectedVariant.sku : sku

  // Update URL when variant changes
  useEffect(() => {
    if (!hasVariants || !selectedVariant) return
    const url = new URL(window.location.href)
    url.searchParams.set('sku', selectedVariant.sku)
    window.history.replaceState(null, '', url.toString())
  }, [selectedVariantId, hasVariants, selectedVariant])

  // Compute effective price, mrp, wholesale based on variant selection
  const effectivePrice = hasVariants
    ? (selectedVariant?.sale_price ?? selectedVariant?.price ?? salePrice ?? basePrice)
    : (salePrice ?? basePrice)
  const effectiveMrp = hasVariants
    ? (selectedVariant?.mrp != null ? Number(selectedVariant.mrp) : mrp)
    : mrp
  const effectiveWholesalePrice = hasVariants
    ? (selectedVariant?.wholesale_price != null ? Number(selectedVariant.wholesale_price) : wholesalePrice)
    : wholesalePrice
  const effectiveStock = hasVariants
    ? (selectedVariant?.stock_quantity ?? 0)
    : stockQuantity

  const mrpDiscount = effectiveMrp && effectiveMrp > effectivePrice
    ? Math.round(((effectiveMrp - effectivePrice) / effectiveMrp) * 100)
    : 0

  // Reset quantity when variant changes
  useEffect(() => {
    setQuantity(1)
  }, [selectedVariantId])

  // Check if product is in wishlist on mount
  useEffect(() => {
    const checkWishlistStatus = async () => {
      try {
        const response = await fetch('/api/wishlist')
        if (response.ok) {
          const data = await response.json()
          const isInList = data.items?.some((item: any) => item.product_id === productId)
          setIsInWishlist(isInList)
        }
      } catch (error) {
        console.error('Failed to check wishlist status:', error)
      }
    }

    checkWishlistStatus()
  }, [productId])

  const handleAddToCart = async () => {
    setIsAddingToCart(true)
    try {
      await addToCart(productId, quantity, selectedVariantId || undefined)
      showToast('Item added to cart!', 'success')
    } catch (error: any) {
      console.error('Add to cart error:', error)
      showToast(error.message || 'Failed to add to cart', 'error')
    } finally {
      setIsAddingToCart(false)
    }
  }

  const handleToggleWishlist = async () => {
    if (!user) {
      showConfirm({
        title: 'Sign In Required',
        message: 'Please sign in to save items to your wishlist and access them anytime.',
        confirmText: 'Sign In',
        cancelText: 'Maybe Later',
        type: 'info',
        onConfirm: () => {
          router.push(`/login?redirect=/products/${productName.toLowerCase().replace(/\s+/g, '-')}`)
        },
      })
      return
    }

    setIsAddingToWishlist(true)
    try {
      if (isInWishlist) {
        const response = await fetch(`/api/wishlist?productId=${productId}`, {
          method: 'DELETE',
        })

        if (response.ok) {
          setIsInWishlist(false)
          showToast('Removed from wishlist', 'success')
        } else {
          const data = await response.json()
          showToast(data.message || 'Failed to remove from wishlist', 'error')
        }
      } else {
        const response = await fetch('/api/wishlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId }),
        })

        if (response.ok) {
          setIsInWishlist(true)
          showToast('Added to wishlist!', 'success')
        } else {
          const data = await response.json()
          showToast(data.message || 'Failed to add to wishlist', 'error')
        }
      }
    } catch (error) {
      showToast('Failed to update wishlist', 'error')
    } finally {
      setIsAddingToWishlist(false)
    }
  }

  const handleBuyNow = async () => {
    setIsBuyingNow(true)
    try {
      await addToCart(productId, quantity, selectedVariantId || undefined)
      router.push('/cart')
    } catch (error: any) {
      console.error('Buy now error:', error)
      showToast(error.message || 'Failed to add to cart', 'error')
      setIsBuyingNow(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Dynamic SKU */}
      <div className="text-sm text-foreground-secondary">
        SKU: <span className="font-medium text-foreground">{displaySku}</span>
      </div>

      {/* Variant Selector */}
      {hasVariants && (
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-2">
            Select {variantType}
          </label>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => (
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
        </div>
      )}

      {/* Price display for variant products */}
      {hasVariants && (
        <>
          <div className="bg-surface rounded-lg p-6">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-4xl font-bold text-primary-600 dark:text-primary-400">
                Rs. {effectivePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              {effectiveMrp && effectiveMrp > effectivePrice && (
                <span className="text-xl text-foreground-muted line-through">
                  Rs. {effectiveMrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>
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
              Inclusive of all taxes
              {gstPercentage ? ` (${gstPercentage}% GST)` : ''}
            </p>
            {effectiveWholesalePrice && (
              <div className="mt-3 pt-3 border-t border-border-default">
                <span className="text-sm text-foreground-secondary">
                  Wholesale Price: <span className="font-semibold text-foreground">Rs. {effectiveWholesalePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </span>
              </div>
            )}
          </div>

          {/* Stock status for variant */}
          <div>
            {effectiveStock > 0 ? (
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-green-700 dark:text-green-400 font-semibold">
                  In Stock ({effectiveStock} available)
                </span>
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

      {/* Quantity Selector */}
      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-2">
          Quantity
        </label>
        <div className="flex items-center border border-border-secondary rounded-lg w-fit">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
            className="px-4 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="px-6 py-2 border-x border-border-secondary min-w-[80px] text-center font-semibold">
            {quantity}
          </span>
          <button
            onClick={() => setQuantity(Math.min(effectiveStock, quantity + 1))}
            disabled={quantity >= effectiveStock}
            className="px-4 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <button
          onClick={handleBuyNow}
          disabled={effectiveStock === 0 || isBuyingNow}
          className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
        >
          {isBuyingNow ? (
            <>
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
              Processing...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Buy Now
            </>
          )}
        </button>

        <button
          onClick={handleAddToCart}
          disabled={effectiveStock === 0 || isAddingToCart}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white px-6 py-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
        >
          {isAddingToCart ? (
            <>
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
              Adding...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Add to Cart
            </>
          )}
        </button>

        <button
          onClick={handleToggleWishlist}
          disabled={isAddingToWishlist}
          className={`w-full px-6 py-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            isInWishlist
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-surface-elevated hover:bg-surface-secondary text-foreground-secondary border border-border-secondary'
          }`}
        >
          {isAddingToWishlist ? (
            <>
              <div className={`animate-spin w-5 h-5 border-2 ${isInWishlist ? 'border-white' : 'border-foreground-secondary'} border-t-transparent rounded-full`}></div>
              {isInWishlist ? 'Removing...' : 'Adding...'}
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill={isInWishlist ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {isInWishlist ? 'Remove from Wishlist' : 'Add to Wishlist'}
            </>
          )}
        </button>
      </div>

      {/* Contact Buttons */}
      <div className="pt-4 border-t border-border-default">
        <p className="text-sm text-foreground-secondary mb-3">Need help with your order?</p>
        <div className="space-y-2">
          <a
            href={`tel:+918903031299`}
            className="w-full bg-surface-elevated hover:bg-surface-secondary border border-border-secondary text-foreground-secondary px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Call: +91 89030 31299
          </a>
          <a
            href={`mailto:jeffistoress@gmail.com?subject=Inquiry about ${productName}&body=Hi, I'm interested in ${productName} (SKU: ${displaySku}). Please provide more details.`}
            className="w-full bg-surface-elevated hover:bg-surface-secondary border border-border-secondary text-foreground-secondary px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Inquiry
          </a>
        </div>
      </div>
    </div>
  )
}

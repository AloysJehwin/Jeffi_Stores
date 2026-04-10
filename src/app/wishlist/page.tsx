'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'

interface WishlistItem {
  id: string
  product_id: string
  products: {
    id: string
    name: string
    slug: string
    base_price: number
    sale_price: number | null
    mrp: number | null
    has_variants: boolean
    stock_quantity: number
    is_in_stock: boolean
    variant_stock_total: number
    variant_min_price: number | null
    product_images: Array<{
      thumbnail_url: string
      is_primary: boolean
    }>
  }
}

export default function WishlistPage() {
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { addToCart } = useCart()
  const { showToast, showConfirm } = useToast()
  const [addingToCart, setAddingToCart] = useState<Set<string>>(new Set())

  const fetchWishlist = async () => {
    try {
      const response = await fetch('/api/wishlist')
      if (response.ok) {
        const data = await response.json()
        setWishlistItems(data.items || [])
      }
    } catch (error) {
      console.error('Failed to fetch wishlist:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchWishlist()
  }, [])

  const handleRemove = async (productId: string) => {
    showConfirm({
      title: 'Remove from Wishlist',
      message: 'Are you sure you want to remove this item from your wishlist?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      type: 'warning',
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/wishlist?productId=${productId}`, {
            method: 'DELETE',
          })
          if (response.ok) {
            await fetchWishlist()
            showToast('Item removed from wishlist', 'success')
          }
        } catch (error) {
          showToast('Failed to remove item', 'error')
        }
      },
    })
  }

  const handleAddToCart = async (productId: string) => {
    setAddingToCart(prev => new Set(prev).add(productId))
    try {
      await addToCart(productId, 1)
      showToast('Item added to cart!', 'success')
    } catch (error: any) {
      showToast(error.message || 'Failed to add to cart', 'error')
    } finally {
      setAddingToCart(prev => {
        const newSet = new Set(prev)
        newSet.delete(productId)
        return newSet
      })
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-foreground-secondary">Loading wishlist...</p>
        </div>
      </div>
    )
  }

  if (wishlistItems.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto text-center">
          <svg className="w-24 h-24 mx-auto text-foreground-muted mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          <h2 className="text-2xl font-bold text-foreground mb-2">Your wishlist is empty</h2>
          <p className="text-foreground-secondary mb-6">Save your favorite items to buy them later</p>
          <Link
            href="/products"
            className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
          >
            Browse Products
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface min-h-screen py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-foreground mb-8">My Wishlist</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {wishlistItems.map((item) => {
            const primaryImage = item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
            const hasVariants = item.products.has_variants
            const price = hasVariants && item.products.variant_min_price
              ? item.products.variant_min_price
              : (item.products.sale_price || item.products.base_price)
            const effectiveStock = hasVariants ? Number(item.products.variant_stock_total) : item.products.stock_quantity
            const isInStock = effectiveStock > 0
            const mrp = item.products.mrp ? Number(item.products.mrp) : null
            const mrpDiscount = mrp && mrp > Number(price)
              ? Math.round(((mrp - Number(price)) / mrp) * 100)
              : 0
            const isAddingToCart = addingToCart.has(item.product_id)

            return (
              <div key={item.id} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-shadow">
                {/* Product Image */}
                <Link href={`/products/${item.products.slug}`} className="block relative h-64 bg-surface-elevated overflow-hidden">
                  {primaryImage ? (
                    <img
                      src={primaryImage.thumbnail_url}
                      alt={item.products.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-24 h-24 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}

                  {mrpDiscount > 0 && (
                    <div className="absolute top-4 right-4 bg-accent-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                      {mrpDiscount}% off
                    </div>
                  )}

                  {/* Remove Button */}
                  <button
                    onClick={() => handleRemove(item.product_id)}
                    className="absolute top-4 left-4 bg-surface-elevated rounded-full p-2 shadow-md hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Link>

                {/* Product Info */}
                <div className="p-4">
                  <Link href={`/products/${item.products.slug}`} className="text-lg font-semibold text-foreground hover:text-accent-600 dark:hover:text-accent-400 transition-colors line-clamp-2 mb-2">
                    {item.products.name}
                  </Link>

                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                      {hasVariants ? 'From ' : ''}₹{Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    {mrp && mrp > Number(price) && (
                      <span className="text-sm text-foreground-muted line-through">
                        ₹{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-foreground-muted mb-4">Inclusive of all taxes</p>

                  {/* Stock Status */}
                  <div className="mb-4">
                    {isInStock ? (
                      <span className="text-sm text-green-600 font-medium">In Stock</span>
                    ) : (
                      <span className="text-sm text-red-600 font-medium">Out of Stock</span>
                    )}
                  </div>

                  {/* Add to Cart Button */}
                  <button
                    onClick={() => handleAddToCart(item.product_id)}
                    disabled={!isInStock || isAddingToCart}
                    className="w-full bg-accent-500 hover:bg-accent-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors disabled:bg-border-default disabled:text-foreground-muted disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isAddingToCart ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
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
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

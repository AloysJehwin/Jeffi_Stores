'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import { AccountNavBar } from '@/components/visitor/AccountSidebar'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'
import { AccountSearchProvider } from '@/contexts/AccountSearchContext'
import FeaturedProducts from '@/components/visitor/FeaturedProducts'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import { wishlistBadges } from '@/components/visitor/account/wishlist-badges'

interface WishlistItem {
  id: string
  product_id: string
  snapshot_price: number | string | null
  snapshot_in_stock: boolean | null
  inventory_in_stock: boolean | null
  products: {
    id: string
    name: string
    slug: string
    base_price: number
    price_ex_gst: number | null
    mrp: number | null
    has_variants: boolean
    stock_status: string
    variant_stock_total: number
    variant_min_price: number | null
    variant_min_mrp: number | null
    product_images: Array<{
      thumbnail_url: string
      is_primary: boolean
    }>
    fragile: boolean | null
    hazardous: boolean | null
    flammable: boolean | null
  }
}

export default function WishlistPage() {
  return (
    <AccountSearchProvider>
      <WishlistInner />
    </AccountSearchProvider>
  )
}

function WishlistInner() {
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { addToCart } = useCart()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const [addingToCart, setAddingToCart] = useState<Set<string>>(new Set())
  const [filterStock, setFilterStock] = useState<'all' | 'in' | 'out'>('all')

  const filteredItems = useMemo(() => {
    if (filterStock === 'all') return wishlistItems
    return wishlistItems.filter(i => {
      const inStock = i.products.has_variants
        ? Number(i.products.variant_stock_total) > 0
        : i.products.stock_status !== 'Out of Stock'
      return filterStock === 'in' ? inStock : !inStock
    })
  }, [wishlistItems, filterStock])

  const fetchWishlist = async () => {
    try {
      const response = await fetch('/api/wishlist')
      if (response.ok) {
        const data = await response.json()
        setWishlistItems(data.items || [])
      }
    } catch {
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchWishlist()
  }, [])

  const handleRemove = async (productId: string) => {
    const ok = await confirm({
      title: 'Remove from Wishlist',
      message: 'Are you sure you want to remove this item from your wishlist?',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
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
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="aspect-square bg-surface-secondary" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-surface-secondary rounded w-3/4" />
                <div className="h-4 bg-surface-secondary rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (wishlistItems.length === 0) {
    return (
      <div className="bg-surface min-h-screen">
        <div className="hidden lg:block">
          <AccountNavBar />
        </div>
        <AccountMobileHeader />
        <div className="container mx-auto px-4 py-4 sm:py-6">
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
            <svg
              className="w-16 h-16 text-foreground-muted mx-auto mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
            <h3 className="text-xl font-semibold text-foreground mb-2">Your wishlist is empty</h3>
            <p className="text-foreground-secondary mb-6">Save your favorite items to buy them later</p>
            <Link
              href="/products"
              className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Browse Products
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface min-h-screen">
      <div className="hidden lg:block">
        <AccountNavBar />
      </div>
      <AccountMobileHeader />
      <div className="container mx-auto px-4 py-4 sm:py-6">
        {/* Stock filter */}
        <div className="flex items-center gap-1.5 mb-4">
          {(
            [
              ['all', 'All'],
              ['in', 'In Stock'],
              ['out', 'Out of Stock'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilterStock(val)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filterStock === val
                  ? 'bg-accent-500 text-white'
                  : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map(item => {
            const primaryImage =
              item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
            const hasVariants = item.products.has_variants
            const price =
              hasVariants && item.products.variant_min_price
                ? item.products.variant_min_price
                : item.products.price_ex_gst || item.products.base_price
            const effectiveStock = hasVariants
              ? Number(item.products.variant_stock_total)
              : item.products.stock_status !== 'Out of Stock'
                ? 1
                : 0
            const isInStock = effectiveStock > 0
            const mrp = item.products.mrp
              ? Number(item.products.mrp)
              : item.products.variant_min_mrp
                ? Number(item.products.variant_min_mrp)
                : null
            const inclPrice =
              hasVariants && item.products.variant_min_price
                ? Number(item.products.variant_min_price)
                : Number(item.products.base_price)
            const mrpDiscount = mrp && mrp > inclPrice ? Math.round(((mrp - inclPrice) / mrp) * 100) : 0
            const isAddingToCart = addingToCart.has(item.product_id)
            const badges = wishlistBadges({
              hasVariants,
              shownPrice: Number(price),
              shownInStock: isInStock,
              basePrice: item.products.base_price,
              inventoryInStock: item.inventory_in_stock,
              snapshotPrice: item.snapshot_price,
              snapshotInStock: item.snapshot_in_stock,
            })

            return (
              <div
                key={item.id}
                className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-shadow group"
              >
                {/* Product Image */}
                <Link
                  href={`/products/${item.products.slug}`}
                  className="block relative aspect-[5/3] border-b border-border-default overflow-hidden mx-3 mt-3 rounded-lg"
                >
                  {primaryImage ? (
                    <>
                      <img
                        src={primaryImage.thumbnail_url}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
                      />
                      <img
                        src={primaryImage.thumbnail_url}
                        alt={item.products.name}
                        className="relative w-full h-full object-contain"
                      />
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg
                        className="w-20 h-20 text-foreground-muted"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  )}

                  {mrpDiscount > 0 && (
                    <div className="absolute top-3 right-3 bg-accent-500 text-white px-2 py-1 rounded-full text-xs font-semibold">
                      {mrpDiscount}% off
                    </div>
                  )}
                  {(badges.backInStock || badges.priceDrop) && (
                    <div className="absolute top-3 left-3 flex flex-col items-start gap-1">
                      {badges.backInStock && (
                        <span className="bg-emerald-600 text-white px-2 py-1 rounded-full text-xs font-semibold">
                          Back in stock
                        </span>
                      )}
                      {badges.priceDrop && (
                        <span className="bg-rose-600 text-white px-2 py-1 rounded-full text-xs font-semibold">
                          Price dropped {badges.priceDrop.pct}%
                        </span>
                      )}
                    </div>
                  )}
                </Link>

                {/* Product Info */}
                <div className="p-4 flex flex-col">
                  {/* Remove Button */}
                  <button
                    onClick={() => handleRemove(item.product_id)}
                    className="self-end mb-1 p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                    aria-label="Remove from wishlist"
                  >
                    <svg
                      className="w-4 h-4 text-red-500 dark:text-red-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  <Link
                    href={`/products/${item.products.slug}`}
                    className="font-semibold text-base text-foreground group-hover:text-accent-600 transition-colors line-clamp-2 min-h-[3rem] mb-2"
                  >
                    {item.products.name}
                  </Link>
                  <ProductWarningBadges
                    fragile={item.products?.fragile}
                    hazardous={item.products?.hazardous}
                    flammable={item.products?.flammable}
                    size="xs"
                  />

                  <div className="mt-auto">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xl font-bold text-primary-600 dark:text-primary-400">
                        {hasVariants ? 'From ' : ''}₹
                        {Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                      {mrp && mrp > Number(price) && (
                        <span className="text-sm text-foreground-muted line-through">
                          ₹{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                    {badges.priceDrop && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mb-1">
                        Was{' '}
                        <span className="line-through">
                          ₹{badges.priceDrop.was.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </p>
                    )}
                    <p className="text-[10px] text-foreground-muted mb-3">Inclusive of all taxes</p>

                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-medium ${isInStock ? 'text-green-600' : 'text-red-600'}`}>
                        {isInStock ? 'In Stock' : 'Out of Stock'}
                      </span>
                    </div>

                    <button
                      onClick={() => handleAddToCart(item.product_id)}
                      disabled={!isInStock || isAddingToCart}
                      className="w-full bg-accent-500 hover:bg-accent-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors disabled:bg-border-default disabled:text-foreground-muted disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                    >
                      {isAddingToCart ? (
                        <>
                          <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                          Adding...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                            />
                          </svg>
                          Add to Cart
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <FeaturedProducts />
      </div>
    </div>
  )
}

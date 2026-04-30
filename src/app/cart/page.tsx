'use client'

import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Link from 'next/link'
import { useState } from 'react'

export default function CartPage() {
  const { cartItems, cartCount, isLoading, removeFromCart, updateQuantity, getCartTotal, getCartTax } = useCart()
  const { user } = useAuth()
  const { showToast, showConfirm } = useToast()
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set())

  const handleQuantityChange = async (cartItemId: string, newQuantity: number) => {
    if (newQuantity < 1) return

    setUpdatingItems(prev => new Set(prev).add(cartItemId))
    try {
      await updateQuantity(cartItemId, newQuantity)
    } catch (error) {
      showToast('Failed to update quantity', 'error')
    } finally {
      setUpdatingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(cartItemId)
        return newSet
      })
    }
  }

  const handleRemove = async (cartItemId: string) => {
    showConfirm({
      title: 'Remove from Cart',
      message: 'Are you sure you want to remove this item from your cart?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      type: 'warning',
      onConfirm: async () => {
        try {
          await removeFromCart(cartItemId)
          showToast('Item removed from cart', 'success')
        } catch (error) {
          showToast('Failed to remove item', 'error')
        }
      },
    })
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-foreground-secondary">Loading cart...</p>
        </div>
      </div>
    )
  }

  if (cartCount === 0) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto text-center">
          <svg className="w-24 h-24 mx-auto text-foreground-muted mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <h2 className="text-2xl font-bold text-foreground mb-2">Your cart is empty</h2>
          <p className="text-foreground-secondary mb-6">Start shopping to add items to your cart</p>
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

  const total = getCartTotal()
  const tax = getCartTax()
  const discount = 0 // You can implement discount logic here
  const finalTotal = total - discount

  return (
    <div className="bg-surface min-h-screen py-4 sm:py-6 lg:py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-foreground mb-4 sm:mb-6 lg:mb-8">Shopping Cart</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
              {cartItems.map((item) => {
                const primaryImage = item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
                const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
                const price = isCustomQty
                  ? item.price_at_addition
                  : (item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price)
                const stockQty = item.variant?.stock_quantity ?? item.products.stock_quantity
                const itemTotal = isCustomQty
                  ? item.price_at_addition * item.quantity
                  : price * item.quantity
                const isUpdating = updatingItems.has(item.id)

                return (
                  <div key={item.id} className="p-4 sm:p-6 border-b border-border-default last:border-b-0">
                    <div className="flex gap-4 sm:gap-6">
                      {/* Product Image */}
                      <Link href={`/products/${item.products.slug}`} className="flex-shrink-0">
                        <div className="w-24 h-24 bg-surface-elevated rounded-lg overflow-hidden border border-border-default">
                          {primaryImage ? (
                            <img
                              src={primaryImage.thumbnail_url}
                              alt={item.products.name}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-12 h-12 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </Link>

                      {/* Product Details */}
                      <div className="flex-1">
                        <Link href={`/products/${item.products.slug}`} className="text-lg font-semibold text-foreground hover:text-accent-600 transition-colors">
                          {item.products.name}
                        </Link>
                        {item.variant && (
                          <p className="text-sm text-foreground-muted mt-0.5">{item.variant.variant_name}</p>
                        )}

                        <div className="mt-2 flex items-center gap-4">
                          <span className="text-lg font-bold text-primary-600 dark:text-primary-400">
                            ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}{isCustomQty ? `/${item.buy_unit}` : ''}
                          </span>
                          {!isCustomQty && item.products.sale_price && (
                            <span className="text-sm text-foreground-muted line-through">
                              ₹{item.products.base_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>

                        {/* Stock Status */}
                        {stockQty < Number(item.quantity) && (
                          <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                            Only {stockQty} left in stock
                          </p>
                        )}

                        {/* Quantity Controls */}
                        <div className="mt-4 flex items-center gap-4">
                          {isCustomQty ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0.001"
                                step="0.001"
                                defaultValue={Number(item.quantity).toFixed(3)}
                                onBlur={(e) => {
                                  const val = parseFloat(e.target.value)
                                  if (!isNaN(val) && val > 0 && val !== Number(item.quantity)) {
                                    handleQuantityChange(item.id, val)
                                  } else {
                                    e.target.value = Number(item.quantity).toFixed(3)
                                  }
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                disabled={isUpdating}
                                className="w-24 px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground font-semibold text-sm text-center focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 disabled:opacity-50"
                              />
                              <span className="text-sm text-foreground-muted">{item.buy_unit}</span>
                              <span className="text-xs text-foreground-muted">@ ₹{Number(item.price_at_addition).toLocaleString('en-IN', { minimumFractionDigits: 2 })}/{item.buy_unit}</span>
                            </div>
                          ) : (
                            <div className="flex items-center border border-border-secondary rounded-lg">
                              <button
                                onClick={() => handleQuantityChange(item.id, Number(item.quantity) - 1)}
                                disabled={isUpdating || Number(item.quantity) <= 1}
                                className="px-3 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                              </button>
                              <span className="px-4 py-2 border-x border-border-secondary min-w-[60px] text-center flex items-center justify-center">
                                {isUpdating ? (
                                  <div className="animate-spin w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full"></div>
                                ) : Math.round(Number(item.quantity))}
                              </span>
                              <button
                                onClick={() => handleQuantityChange(item.id, Number(item.quantity) + 1)}
                                disabled={isUpdating || Number(item.quantity) >= stockQty}
                                className="px-3 py-2 hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>
                          )}

                          <button
                            onClick={() => handleRemove(item.id)}
                            className="text-red-600 hover:text-red-700 text-sm font-medium transition-colors"
                          >
                            Remove
                          </button>
                        </div>

                        {/* Item Total */}
                        <div className="mt-4">
                          <span className="text-sm text-foreground-secondary">Subtotal: </span>
                          <span className="text-lg font-bold text-foreground">
                            ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-20">
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-foreground-secondary">
                  <span>Subtotal ({cartCount} items)</span>
                  <span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-foreground-muted text-sm">
                  <span>Incl. GST</span>
                  <span>₹{tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-₹{discount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="border-t border-border-default pt-3">
                  <div className="flex justify-between text-lg font-bold text-foreground">
                    <span>Total</span>
                    <span>₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <p className="text-xs text-foreground-muted mt-1">Price inclusive of all taxes</p>
                </div>
              </div>

              {user ? (
                <Link
                  href="/checkout"
                  className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center"
                >
                  Proceed to Checkout
                  <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ) : (
                <div className="space-y-3">
                  <Link
                    href="/login?redirect=/checkout"
                    className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center"
                  >
                    Login to Checkout
                    <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                  <p className="text-sm text-foreground-secondary text-center">
                    New customer? <Link href="/signup" className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium">Create an account</Link>
                  </p>
                </div>
              )}

              <Link
                href="/products"
                className="block w-full text-center text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium mt-4"
              >
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

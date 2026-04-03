'use client'

import { useState, useEffect } from 'react'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'

interface ProductActionsProps {
  productId: string
  productName: string
  sku: string
  stockQuantity: number
}

export default function ProductActions({ productId, productName, sku, stockQuantity }: ProductActionsProps) {
  const { addToCart } = useCart()
  const { showToast, showConfirm } = useToast()
  const { user } = useAuth()
  const router = useRouter()
  const [isAddingToCart, setIsAddingToCart] = useState(false)
  const [isBuyingNow, setIsBuyingNow] = useState(false)
  const [isAddingToWishlist, setIsAddingToWishlist] = useState(false)
  const [isInWishlist, setIsInWishlist] = useState(false)
  const [quantity, setQuantity] = useState(1)

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
      await addToCart(productId, quantity)
      showToast('Item added to cart!', 'success')
    } catch (error: any) {
      console.error('Add to cart error:', error)
      showToast(error.message || 'Failed to add to cart', 'error')
    } finally {
      setIsAddingToCart(false)
    }
  }

  const handleToggleWishlist = async () => {
    // Check if user is logged in for wishlist
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
        // Remove from wishlist
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
        // Add to wishlist
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
      await addToCart(productId, quantity)
      router.push('/cart')
    } catch (error: any) {
      console.error('Buy now error:', error)
      showToast(error.message || 'Failed to add to cart', 'error')
      setIsBuyingNow(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Quantity Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Quantity
        </label>
        <div className="flex items-center border border-gray-300 rounded-lg w-fit">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
            className="px-4 py-2 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="px-6 py-2 border-x border-gray-300 min-w-[80px] text-center font-semibold">
            {quantity}
          </span>
          <button
            onClick={() => setQuantity(Math.min(stockQuantity, quantity + 1))}
            disabled={quantity >= stockQuantity}
            className="px-4 py-2 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          disabled={stockQuantity === 0 || isBuyingNow}
          className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
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
          disabled={stockQuantity === 0 || isAddingToCart}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white px-6 py-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
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
              : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300'
          }`}
        >
          {isAddingToWishlist ? (
            <>
              <div className={`animate-spin w-5 h-5 border-2 ${isInWishlist ? 'border-white' : 'border-gray-700'} border-t-transparent rounded-full`}></div>
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
      <div className="pt-4 border-t border-gray-200">
        <p className="text-sm text-gray-600 mb-3">Need help with your order?</p>
        <div className="space-y-2">
          <a
            href={`tel:+918903031299`}
            className="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Call: +91 89030 31299
          </a>
          <a
            href={`mailto:jeffistoress@gmail.com?subject=Inquiry about ${productName}&body=Hi, I'm interested in ${productName} (SKU: ${sku}). Please provide more details.`}
            className="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
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

'use client'

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react'
import { useAuth } from './AuthContext'

interface CartItem {
  id: string
  product_id: string
  variant_id: string | null
  quantity: number
  price_at_addition: number
  products: {
    id: string
    name: string
    slug: string
    base_price: number
    sale_price: number | null
    gst_percentage: number | null
    stock_quantity: number
    is_in_stock: boolean
    product_images: Array<{
      thumbnail_url: string
      is_primary: boolean
    }>
  }
  variant: {
    id: string
    variant_name: string
    sku: string
    price: number | null
    mrp: number | null
    sale_price: number | null
    wholesale_price: number | null
    stock_quantity: number
  } | null
}

interface CartContextType {
  cartItems: CartItem[]
  cartCount: number
  isLoading: boolean
  addToCart: (productId: string, quantity?: number, variantId?: string) => Promise<void>
  removeFromCart: (cartItemId: string) => Promise<void>
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>
  refreshCart: () => Promise<void>
  getCartTotal: () => number
  getCartTax: () => number
  clearCart: () => void
}

const CartContext = createContext<CartContextType | undefined>(undefined)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { user } = useAuth()
  const prevUserIdRef = useRef<string | null | undefined>(undefined)

  const fetchCart = async () => {
    try {
      console.log('Fetching cart...')
      const response = await fetch('/api/cart')
      if (response.ok) {
        const data = await response.json()
        console.log('Cart data received:', data)
        setCartItems(data.items || [])
      } else {
        console.error('Cart fetch failed:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Failed to fetch cart:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCart()
  }, [])

  // Re-fetch cart when user changes (login/logout)
  useEffect(() => {
    const currentUserId = user?.id ?? null
    if (prevUserIdRef.current === undefined) {
      // Initial mount — skip, the [] effect handles it
      prevUserIdRef.current = currentUserId
      return
    }
    if (prevUserIdRef.current !== currentUserId) {
      prevUserIdRef.current = currentUserId
      fetchCart()
    }
  }, [user])

  const addToCart = async (productId: string, quantity = 1, variantId?: string) => {
    try {
      const response = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantity, variantId: variantId || null }),
      })

      if (response.ok) {
        await fetchCart()
      } else {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add to cart')
      }
    } catch (error) {
      console.error('Add to cart error:', error)
      throw error
    }
  }

  const removeFromCart = async (cartItemId: string) => {
    try {
      const response = await fetch(`/api/cart?id=${cartItemId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await fetchCart()
      } else {
        throw new Error('Failed to remove from cart')
      }
    } catch (error) {
      console.error('Remove from cart error:', error)
      throw error
    }
  }

  const updateQuantity = async (cartItemId: string, quantity: number) => {
    try {
      const response = await fetch('/api/cart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartItemId, quantity }),
      })

      if (response.ok) {
        await fetchCart()
      } else {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update quantity')
      }
    } catch (error) {
      console.error('Update quantity error:', error)
      throw error
    }
  }

  const refreshCart = async () => {
    await fetchCart()
  }

  const getCartTotal = () => {
    return cartItems.reduce((total, item) => {
      const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
      return total + price * item.quantity
    }, 0)
  }

  const getCartTax = () => {
    return cartItems.reduce((tax, item) => {
      const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
      const gstRate = item.products.gst_percentage || 0
      const itemTotal = price * item.quantity
      const itemTax = itemTotal - (itemTotal / (1 + gstRate / 100))
      return tax + itemTax
    }, 0)
  }

  const clearCart = () => {
    setCartItems([])
  }

  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0)

  return (
    <CartContext.Provider
      value={{
        cartItems,
        cartCount,
        isLoading,
        addToCart,
        removeFromCart,
        updateQuantity,
        refreshCart,
        getCartTotal,
        getCartTax,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}

'use client'

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react'
import { useAuth } from './AuthContext'

interface CartItem {
  id: string
  product_id: string
  variant_id: string | null
  quantity: number
  price_at_addition: number
  buy_mode: string
  buy_unit: string | null
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
      image_url: string
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
    pricing_type?: string
    unit?: string | null
    numeric_value?: number | null
    weight_rate?: number | null
    weight_unit?: string | null
    length_rate?: number | null
    length_unit?: string | null
  } | null
}

interface CartContextType {
  cartItems: CartItem[]
  cartCount: number
  isLoading: boolean
  addToCart: (productId: string, quantity?: number, variantId?: string, buyMode?: string, buyUnit?: string) => Promise<void>
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
      const response = await fetch('/api/cart', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setCartItems(data.items || [])
      }
    } catch {
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCart()
  }, [])

  useEffect(() => {
    const currentUserId = user?.id ?? null
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = currentUserId
      return
    }
    if (prevUserIdRef.current !== currentUserId) {
      prevUserIdRef.current = currentUserId
      fetchCart()
    }
  }, [user])

  const addToCart = async (productId: string, quantity = 1, variantId?: string, buyMode = 'unit', buyUnit?: string) => {
    try {
      const response = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantity, variantId: variantId || null, buyMode, buyUnit: buyUnit || null }),
        credentials: 'include',
      })

      if (response.ok) {
        await fetchCart()
      } else {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add to cart')
      }
    } catch (error) {
      throw error
    }
  }

  const removeFromCart = async (cartItemId: string) => {
    try {
      const response = await fetch(`/api/cart?id=${cartItemId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (response.ok) {
        await fetchCart()
      } else {
        throw new Error('Failed to remove from cart')
      }
    } catch (error) {
      throw error
    }
  }

  const updateQuantity = async (cartItemId: string, quantity: number) => {
    try {
      const response = await fetch('/api/cart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartItemId, quantity }),
        credentials: 'include',
      })

      if (response.ok) {
        await fetchCart()
      } else {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update quantity')
      }
    } catch (error) {
      throw error
    }
  }

  const refreshCart = async () => {
    await fetchCart()
  }

  const getCartTotal = () => {
    return cartItems.reduce((total, item) => {
      if (item.buy_mode === 'weight' || item.buy_mode === 'length') {
        return total + item.price_at_addition * item.quantity
      }
      const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
      return total + price * item.quantity
    }, 0)
  }

  const getCartTax = () => {
    return cartItems.reduce((tax, item) => {
      if (item.buy_mode === 'weight' || item.buy_mode === 'length') {
        const gstRate = item.products.gst_percentage || 0
        const itemTotal = item.price_at_addition * item.quantity
        return tax + (itemTotal - itemTotal / (1 + gstRate / 100))
      }
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

  const cartCount = cartItems.length

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

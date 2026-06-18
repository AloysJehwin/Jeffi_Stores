'use client'

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react'
import { useAuth } from './AuthContext'

interface CartItem {
  id: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  quantity: number
  price_at_addition: number
  buy_mode: string
  buy_unit: string | null
  cart_item_unit?: {
    unit: string
    display_label: string | null
    factor: number
    is_base: boolean
    is_sell_default: boolean
    dimension: string | null
  } | null
  products: {
    id: string
    name: string
    slug: string
    sku: string | null
    base_price: number
    price_ex_gst: number | null
    mrp: number | null
    gst_percentage: number | null
    stock_status: string
    brand_name: string | null
    category_id: string | null
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
    price_ex_gst: number | null
    stock_status: string
    pricing_type?: string
    unit?: string | null
    numeric_value?: number | null
  } | null
  sub_variant: {
    id: string
    sub_variant_name: string
    sku: string | null
    price: number | null
    mrp: number | null
    price_ex_gst: number | null
    mrp_ex_gst: number | null
    stock_status: string
    inventory_quantity: number
  } | null
}

interface CartContextType {
  cartItems: CartItem[]
  savedItems: CartItem[]
  cartCount: number
  isLoading: boolean
  addToCart: (productId: string, quantity?: number, variantId?: string, buyMode?: string, buyUnit?: string, subVariantId?: string) => Promise<void>
  removeFromCart: (cartItemId: string) => Promise<void>
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>
  saveForLater: (cartItemId: string) => Promise<void>
  moveToCart: (cartItemId: string) => Promise<void>
  refreshCart: () => Promise<void>
  getCartTotal: () => number
  getCartTax: () => number
  clearCart: () => void
}

const CartContext = createContext<CartContextType | undefined>(undefined)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [savedItems, setSavedItems] = useState<CartItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { user } = useAuth()
  const prevUserIdRef = useRef<string | null | undefined>(undefined)

  const portalHeaders = (): Record<string, string> =>
    user?.isBusiness ? { 'X-Auth-Portal': 'business' } : {}

  const fetchCart = async () => {
    try {
      const headers = portalHeaders()
      const [activeRes, savedRes] = await Promise.all([
        fetch('/api/cart', { credentials: 'include', headers }),
        fetch('/api/cart?saved=1', { credentials: 'include', headers }),
      ])
      if (activeRes.ok) {
        const data = await activeRes.json()
        setCartItems(data.items || [])
      }
      if (savedRes.ok) {
        const data = await savedRes.json()
        setSavedItems(data.items || [])
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

  const addToCart = async (productId: string, quantity = 1, variantId?: string, buyMode = 'unit', buyUnit?: string, subVariantId?: string) => {
    try {
      const response = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
        body: JSON.stringify({ productId, quantity, variantId: variantId || null, buyMode, buyUnit: buyUnit || null, subVariantId: subVariantId || null }),
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
        headers: portalHeaders(),
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
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
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

  const saveForLater = async (cartItemId: string) => {
    try {
      const response = await fetch('/api/cart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
        body: JSON.stringify({ cartItemId, savedForLater: true }),
        credentials: 'include',
      })
      if (response.ok) {
        await fetchCart()
      } else {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save for later')
      }
    } catch (error) {
      throw error
    }
  }

  const moveToCart = async (cartItemId: string) => {
    try {
      const response = await fetch('/api/cart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
        body: JSON.stringify({ cartItemId, savedForLater: false }),
        credentials: 'include',
      })
      if (response.ok) {
        await fetchCart()
      } else {
        const data = await response.json()
        throw new Error(data.error || 'Failed to move to cart')
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
      const price = item.price_at_addition > 0
        ? item.price_at_addition
        : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
      const categoryId = item.products.category_id
      const discountPct = (user?.isBusiness && user.approvalStatus === 'approved' && categoryId)
        ? (user.businessDiscountMap?.[categoryId] ?? 0)
        : 0
      const effectivePrice = discountPct > 0 ? price * (1 - discountPct / 100) : price
      return total + effectivePrice * item.quantity
    }, 0)
  }

  const getCartTax = () => {
    return cartItems.reduce((tax, item) => {
      const price = item.price_at_addition > 0
        ? item.price_at_addition
        : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
      const categoryId = item.products.category_id
      const discountPct = (user?.isBusiness && user.approvalStatus === 'approved' && categoryId)
        ? (user.businessDiscountMap?.[categoryId] ?? 0)
        : 0
      const effectivePrice = discountPct > 0 ? price * (1 - discountPct / 100) : price
      const gstRate = item.products.gst_percentage || 0
      const itemTotal = effectivePrice * item.quantity
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
        savedItems,
        cartCount,
        isLoading,
        addToCart,
        removeFromCart,
        updateQuantity,
        saveForLater,
        moveToCart,
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

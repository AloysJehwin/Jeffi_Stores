'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { couponLookup, urlCoupon, urlCouponCode } from '@/components/visitor/coupons/terms'
import { digitalLinesSubtotal } from '@/components/visitor/cart/digital-lines'

// The cart page's state and actions, shared by the built-in cart and the AI-placed cart parts. Moved as-is from the
// old CartClient: coupon apply/remove, the URL coupon, quantities, save for later and the start of checkout.

export interface AppliedCoupon {
  couponId: string
  code: string
  description: string | null
  discountAmount: number
}

type CartApi = ReturnType<typeof useCart>
export type CartLine = CartApi['cartItems'][number]

export interface CartParts extends CartApi {
  user: ReturnType<typeof useAuth>['user']
  gstEnabled: boolean
  hasInactiveItems: boolean
  updatingItems: Set<string>
  couponCode: string
  setCouponCode: (v: string) => void
  appliedCoupon: AppliedCoupon | null
  couponLoading: boolean
  couponError: string
  setCouponError: (v: string) => void
  handleApplyCoupon: (code?: string) => void
  handleRemoveCoupon: () => void
  couponNotice: ReactNode
  proceedingToCheckout: boolean
  proceedToCheckout: () => Promise<void>
  handleQuantityChange: (cartItemId: string, newQuantity: number) => Promise<void>
  handleRemove: (cartItemId: string) => Promise<void>
  handleSaveForLater: (cartItemId: string) => Promise<void>
  handleMoveToCart: (cartItemId: string) => Promise<void>
  total: number
  physicalTotal: number
  tax: number
  discount: number
  finalTotal: number
}

const CartPartsContext = createContext<CartParts | null>(null)

/** The cart parts' shared state, or null outside a cart page (the studio preview renders sample lines instead). */
export const useCartParts = () => useContext(CartPartsContext)

/** Mounted once per cart page; a nested provider reuses the outer one, so every part shares one cart. */
export function CartPartsProvider({ children }: { children: ReactNode }) {
  const outer = useContext(CartPartsContext)
  return outer ? <>{children}</> : <CartPartsRoot>{children}</CartPartsRoot>
}

function CartPartsRoot({ children }: { children: ReactNode }) {
  const cart = useCart()
  const { cartItems, isLoading, removeFromCart, updateQuantity, saveForLater, moveToCart, getCartTotal, getCartTax } = cart
  const gstEnabled = useStoreConfig().flags.gstEnabled
  const hasInactiveItems = cartItems.some((item: any) => item.products?.is_active === false)
  const { user, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set())
  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState('')
  const [proceedingToCheckout, setProceedingToCheckout] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // ?coupon=CODE (or a legacy ?couponId=) from a win card or an old checkout link.
  const fromUrl = urlCoupon(searchParams)
  const urlCode = urlCouponCode(fromUrl)
  const urlKey = fromUrl ? JSON.stringify(fromUrl) : null
  const consumedUrlCoupon = useRef<string | null>(null)

  const applyCoupon = async (input: { code: string } | { couponId: string }) => {
    setCouponLoading(true)
    setCouponError('')
    try {
      const res = await fetch('/api/coupons/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...input, subtotal: getCartTotal() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCouponError(data.error || 'Invalid coupon')
      } else {
        setAppliedCoupon({
          couponId: data.couponId,
          code: data.code,
          description: data.description,
          discountAmount: data.discountAmount,
        })
        setCouponCode('')
        showToast(
          `Coupon "${data.code}" applied — saving ₹${data.discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          'success'
        )
      }
    } catch {
      setCouponError('Failed to apply coupon')
    } finally {
      setCouponLoading(false)
    }
  }

  const handleApplyCoupon = (codeArg?: string) => {
    const code = (codeArg ?? couponCode).trim()
    if (code) void applyCoupon({ code })
  }

  // Apply the URL's coupon once there is something to apply it to, then drop it from the URL so a
  // refresh doesn't re-apply. Signed out or an empty cart keeps it, with a notice.
  useEffect(() => {
    if (!fromUrl || !urlKey) {
      consumedUrlCoupon.current = null
      return
    }
    if (consumedUrlCoupon.current === urlKey) return
    if (isLoading || authLoading || !user || cartItems.length === 0) return
    consumedUrlCoupon.current = urlKey
    if (urlCode) setCouponCode(urlCode)
    void applyCoupon(couponLookup(fromUrl))
    const next = new URLSearchParams(searchParams.toString())
    for (const key of ['coupon', 'couponCode', 'couponId']) next.delete(key)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey, isLoading, authLoading, user, cartItems.length])

  const couponLabel = urlCode ? (
    <span className="font-mono font-bold text-accent-700 dark:text-accent-300">{urlCode}</span>
  ) : (
    'Your coupon'
  )
  const couponNotice =
    !fromUrl || authLoading || (user && cartItems.length > 0) ? null : (
      <div
        role="status"
        className="mb-4 rounded-lg border border-dashed border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20 px-4 py-3 text-sm text-foreground-secondary"
      >
        {user ? (
          <>{couponLabel} is saved to your account. Add something to your cart and it applies here.</>
        ) : (
          <>
            Sign in to use {couponLabel} — it&apos;s saved to your account.{' '}
            <Link
              href={`/login?redirect=${encodeURIComponent(`${pathname}?${searchParams.toString()}`)}`}
              className="font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300"
            >
              Sign in
            </Link>
          </>
        )}
      </div>
    )

  async function proceedToCheckout() {
    setProceedingToCheckout(true)
    try {
      const res = await fetch('/api/checkout/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'cart' }),
      })
      const data = await res.json()
      if (!res.ok || !data.intent) {
        showToast(data?.error || 'Failed to start checkout', 'error')
        setProceedingToCheckout(false)
        return
      }
      const params = new URLSearchParams({ intent: data.intent })
      if (appliedCoupon) params.set('couponCode', appliedCoupon.code)
      router.push(`/checkout/review?${params.toString()}`)
    } catch {
      showToast('Could not reach the server. Please try again.', 'error')
      setProceedingToCheckout(false)
    }
  }

  const handleQuantityChange = async (cartItemId: string, newQuantity: number) => {
    if (newQuantity < 1) return

    setUpdatingItems(prev => new Set(prev).add(cartItemId))
    try {
      await updateQuantity(cartItemId, newQuantity)
    } catch (error) {
      showToast(error instanceof Error && error.message ? error.message : 'Failed to update quantity', 'error')
    } finally {
      setUpdatingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(cartItemId)
        return newSet
      })
    }
  }

  const handleRemove = async (cartItemId: string) => {
    const ok = await confirm({
      title: 'Remove from Cart',
      message: 'Are you sure you want to remove this item from your cart?',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await removeFromCart(cartItemId)
      showToast('Item removed from cart', 'success')
    } catch (error) {
      showToast('Failed to remove item', 'error')
    }
  }

  const handleSaveForLater = async (cartItemId: string) => {
    try {
      await saveForLater(cartItemId)
      showToast('Saved for later', 'success')
    } catch {
      showToast('Failed to save', 'error')
    }
  }

  const handleMoveToCart = async (cartItemId: string) => {
    setUpdatingItems(prev => new Set(prev).add(cartItemId))
    try {
      await moveToCart(cartItemId)
      showToast('Moved to cart', 'success')
    } catch {
      showToast('Failed to move', 'error')
    } finally {
      setUpdatingItems(prev => {
        const next = new Set(prev)
        next.delete(cartItemId)
        return next
      })
    }
  }

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null)
    setCouponError('')
  }

  const total = getCartTotal()
  // Digital lines don't ship, so only physical lines count towards free delivery.
  const physicalTotal = Math.max(0, total - digitalLinesSubtotal(cartItems as any[], gstEnabled))
  const tax = getCartTax()
  const discount = appliedCoupon?.discountAmount ?? 0
  const finalTotal = Math.max(0, total - discount)

  const value: CartParts = {
    ...cart,
    user,
    gstEnabled,
    hasInactiveItems,
    updatingItems,
    couponCode,
    setCouponCode,
    appliedCoupon,
    couponLoading,
    couponError,
    setCouponError,
    handleApplyCoupon,
    handleRemoveCoupon,
    couponNotice,
    proceedingToCheckout,
    proceedToCheckout,
    handleQuantityChange,
    handleRemove,
    handleSaveForLater,
    handleMoveToCart,
    total,
    physicalTotal,
    tax,
    discount,
    finalTotal,
  }
  return <CartPartsContext.Provider value={value}>{children}</CartPartsContext.Provider>
}

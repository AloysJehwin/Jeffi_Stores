'use client'

import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { isDigitalLine, digitalLinesSubtotal } from '@/components/visitor/cart/digital-lines'
import { urlCoupon, withCoupon } from '@/components/visitor/coupons/terms'
import { trackBeginCheckout } from '@/lib/client/analytics'
import { razorpayDisplayConfig, upiFlag, useUpiPayment, type PaymentChoice } from '@/components/payments'

// The checkout page's state and the whole payment flow, shared by the built-in checkout and the AI-placed checkout
// parts. Moved unchanged from the old CheckoutClient: intent and buy-now loading, address and shipping rates, coupon,
// payment method rules, Razorpay (with 3DS reload recovery), UPI, COD and order placement. Parts only read it; the
// one part that submits is PaymentStep, which places this flow's own form and button.

export interface BuyNowItem {
  productId: string
  variantId: string | null
  subVariantId: string | null
  qty: number
  buyMode: string
  buyUnit: string | null
  price: number
  productName: string
  variantName: string | null
  subVariantName: string | null
  sku: string | null
  mrp: number | null
  gstPercentage: number | null
  brandName: string | null
  imageUrl: string | null
}

type CartApi = ReturnType<typeof useCart>

export interface CheckoutParts {
  /** verifying: a payment is being confirmed; loading: the order isn't ready to show; ready: render the checkout. */
  phase: 'verifying' | 'loading' | 'ready'
  /** The built-in checkout pays on this page, so a PaymentStep part stays empty (one payment flow per page). */
  builtInPayment: boolean
  retryVerify: () => void
  user: ReturnType<typeof useAuth>['user']
  cartItems: CartApi['cartItems']
  cartCount: number
  isBuyNow: boolean
  buyNowItem: BuyNowItem | null
  gstEnabled: boolean
  storeIdentity: ReturnType<typeof useStoreConfig>['identity']
  address: any
  notes: string
  setNotes: (v: string) => void
  couponCode: string | null
  discountAmount: number
  shippingCharge: number | null
  codFee: number
  serviceable: boolean
  hasDigital: boolean
  paymentMethod: PaymentChoice
  choosePayment: (v: PaymentChoice) => void
  isRazorpayEnabled: boolean
  upiEnabled: boolean
  upi: ReturnType<typeof useUpiPayment>
  isSubmitting: boolean
  setIsSubmitting: (v: boolean) => void
  error: string
  existingOrder: { id: string; orderNumber: string } | null
  isCancellingPrevious: boolean
  handleCancelPreviousOrder: () => Promise<void>
  handleSubmitOrder: (e: React.FormEvent) => Promise<void>
  subtotal: number
  tax: number
  effectiveCodFee: number
  finalTotal: number
  codAvailable: boolean
  noPaymentMethod: boolean
  isOnlinePay: boolean
  submitDisabled: boolean
}

const CheckoutPartsContext = createContext<CheckoutParts | null>(null)

/** The checkout parts' shared state, or null outside a checkout page (the studio preview renders samples instead). */
export const useCheckoutParts = () => useContext(CheckoutPartsContext)

/** Mounted once per checkout page; a nested provider reuses the outer one, so there is only ever one payment flow. */
export function CheckoutProvider({ children, builtInPayment = true }: { children: ReactNode; builtInPayment?: boolean }) {
  const outer = useContext(CheckoutPartsContext)
  if (outer) return <>{children}</>
  return (
    <Suspense>
      <CheckoutRoot builtInPayment={builtInPayment}>{children}</CheckoutRoot>
    </Suspense>
  )
}

function CheckoutRoot({ children, builtInPayment }: { children: ReactNode; builtInPayment: boolean }) {
  const { cartItems, cartCount, getCartTotal, getCartTax, clearCart, isLoading: cartLoading } = useCart()
  const { user, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()
  const isRazorpayEnabled = useStoreConfig().flags.razorpayEnabled
  const isCodSiteEnabled = useStoreConfig().flags.codEnabled
  const storeIdentity = useStoreConfig().identity
  const gstEnabled = useStoreConfig().flags.gstEnabled
  const upiEnabled = upiFlag(useStoreConfig().flags)
  const router = useRouter()
  const searchParams = useSearchParams()

  const intentToken = searchParams.get('intent')
  const [intentMode, setIntentMode] = useState<'cart' | 'buyNow' | null>(null)
  const isBuyNow =
    intentMode === 'buyNow' || (intentMode === null && searchParams.get('buyNow') === '1' && !intentToken)
  const couponId = searchParams.get('couponId')
  // Every redirect off this page hands the coupon on, and sign-in comes back to the full URL.
  const coupon = urlCoupon(searchParams)
  const reviewPath = withCoupon('/checkout/review', coupon, 'review')
  const loginPath = () => {
    const qs = searchParams.toString()
    return `/login?redirect=${encodeURIComponent(qs ? `/checkout?${qs}` : '/checkout')}`
  }
  const recoveringPayment = useRef(false)

  const authWasLoading = useRef(false)
  useEffect(() => {
    if (authLoading) authWasLoading.current = true
  }, [authLoading])
  const [couponCode, setCouponCode] = useState<string | null>(null)
  const [discountAmount, setDiscountAmount] = useState(0)
  const [shippingCharge, setShippingCharge] = useState<number | null>(null)
  const [codFee, setCodFee] = useState<number>(0)
  const [serviceable, setServiceable] = useState<boolean>(true)
  const [rateDigital, setRateDigital] = useState<{ hasDigital: boolean; digitalOnly: boolean } | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [address, setAddress] = useState<any>(null)
  const [isLoadingAddress, setIsLoadingAddress] = useState(true)
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentChoice>(upiEnabled ? 'upi' : isRazorpayEnabled ? 'razorpay' : 'cod')
  // Once the customer picks a method the UPI default stops re-applying.
  const payTouched = useRef(false)
  const upi = useUpiPayment({ returnTo: '/account/orders' })
  const [razorpayLoaded, setRazorpayLoaded] = useState(false)
  const [existingOrder, setExistingOrder] = useState<{ id: string; orderNumber: string } | null>(null)
  const [isCancellingPrevious, setIsCancellingPrevious] = useState(false)
  const razorpayOpen = useRef(false)
  const razorpayCleanup = useRef<(() => void) | null>(null)
  const [pendingVerify, setPendingVerify] = useState<{
    razorpayOrderId: string
    razorpayPaymentId: string
    razorpaySignature: string
    draftToken: string
  } | null>(null)

  const [buyNowItem, setBuyNowItem] = useState<BuyNowItem | null>(null)

  useEffect(() => {
    // Recover payment after page reload mid-payment (e.g. 3DS opened new tab)
    try {
      const raw = sessionStorage.getItem('rzp_pending')
      if (raw) {
        const pending = JSON.parse(raw)
        const age = Date.now() - (pending.ts || 0)
        if (age < 1800_000 && pending.draftToken && pending.razorpayOrderId) {
          sessionStorage.removeItem('rzp_pending')
          recoveringPayment.current = true
          if (pending.razorpayPaymentId && pending.razorpaySignature) {
            // Payment IDs present — verify directly
            setPendingVerify(pending)
          } else {
            // No payment IDs yet — check if Razorpay captured it server-side
            setPendingVerify({ ...pending, razorpayPaymentId: '', razorpaySignature: '' })
          }
        } else {
          sessionStorage.removeItem('rzp_pending')
        }
      }
    } catch {}
  }, [])

  // Auto-retry verify on mount if all payment tokens are present
  useEffect(() => {
    if (!pendingVerify) return
    if (pendingVerify.razorpayPaymentId && pendingVerify.razorpaySignature) {
      // Full tokens — verify directly
      setIsSubmitting(true)
      verifyPayment(pendingVerify.razorpayOrderId, pendingVerify.razorpayPaymentId, pendingVerify.razorpaySignature, {
        draftToken: pendingVerify.draftToken,
      }).finally(() => setPendingVerify(null))
    } else {
      // No payment IDs — poll until Razorpay order is paid or times out (~60s)
      setIsSubmitting(true)
      const maxAttempts = 20
      let attempts = 0
      const poll = () => {
        fetch('/api/razorpay/check-pending', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpayOrderId: pendingVerify.razorpayOrderId,
            draftToken: pendingVerify.draftToken,
          }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.order) {
              try {
                sessionStorage.removeItem('rzp_pending')
              } catch {}
              clearCart()
              showToast('Payment confirmed!', 'success')
              window.location.href = `/account/orders/confirmation?orderId=${data.order.id}`
            } else if (data.status === 'pending' && attempts < maxAttempts) {
              attempts++
              setTimeout(poll, 3000)
            } else {
              showToast(data.error || 'Could not confirm payment. Check My Orders or contact support.', 'error')
              setIsSubmitting(false)
              setPendingVerify(null)
            }
          })
          .catch(() => {
            if (attempts < maxAttempts) {
              attempts++
              setTimeout(poll, 3000)
            } else {
              showToast('Could not confirm payment. Check My Orders or contact support.', 'error')
              setIsSubmitting(false)
              setPendingVerify(null)
            }
          })
      }
      poll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!pendingVerify])

  useEffect(() => {
    if (!authLoading && !user && authWasLoading.current) {
      router.push(loginPath())
      return
    }

    // No intent: an old "use at checkout" link or the cart's sign-in round trip. The cart applies
    // coupons and the review page starts checkout; this page only pays for an intent.
    if (!intentToken && !isBuyNow) {
      if (cartLoading || razorpayOpen.current || recoveringPayment.current) return
      if (coupon || cartCount === 0) router.replace(withCoupon('/cart', coupon, 'cart'))
      else if (!authLoading) router.replace(user ? reviewPath : loginPath())
      return
    }

    const addressId = searchParams.get('addressId')

    if (intentToken) {
      fetch(`/api/checkout/intents/${encodeURIComponent(intentToken)}`, { credentials: 'include' })
        .then(async r => {
          const d = await r.json()
          if (!r.ok) {
            router.push('/')
            return
          }
          if (d.mode === 'cart') {
            setIntentMode('cart')
            const intentAddressId = d.addressId || addressId
            if (!intentAddressId) {
              router.push(reviewPath)
              return
            }
            if (d.shippingCharge != null) setShippingCharge(Number(d.shippingCharge))
            fetchAddress(intentAddressId, d.shippingCharge != null)
            return
          }
          setIntentMode('buyNow')
          if (d.isDigital) setRateDigital({ hasDigital: true, digitalOnly: true })
          setBuyNowItem({
            productId: d.productId,
            variantId: d.variantId || null,
            subVariantId: d.subVariantId || null,
            qty: Number(d.qty),
            buyMode: d.buyMode,
            buyUnit: d.buyUnit || null,
            price: Number(d.price),
            productName: d.productName || '',
            variantName: d.variantName || null,
            subVariantName: d.subVariantName || null,
            sku: d.sku || null,
            mrp: d.mrp != null ? Number(d.mrp) : null,
            gstPercentage: d.gstPercentage != null ? Number(d.gstPercentage) : null,
            brandName: d.brandName || null,
            imageUrl: null,
          })
          const imageUrl = `/api/products/${d.productId}/primary-image${d.variantId ? `?variantId=${d.variantId}` : ''}`
          fetch(imageUrl)
            .then(r => r.json())
            .then(data => {
              setBuyNowItem(prev => (prev ? { ...prev, imageUrl: data.imageUrl || null } : prev))
            })
            .catch(() => {})
        })
        .catch(() => router.push('/'))
      return
    }

    if (isBuyNow) {
      const productId = searchParams.get('productId')
      const variantId = searchParams.get('variantId')
      const qty = parseFloat(searchParams.get('qty') || '1')
      const buyMode = searchParams.get('buyMode') || 'unit'
      const buyUnit = searchParams.get('buyUnit')

      if (!productId) {
        router.push('/')
        return
      }
      if (!addressId) {
        router.push(reviewPath)
        return
      }

      fetchAddress(addressId, false)

      // Resolve price server-side via intent — never trust URL-provided price
      fetch('/api/checkout/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ productId, variantId: variantId || null, qty, buyMode, buyUnit: buyUnit || null }),
      })
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then(data => {
          if (!data?.intent) {
            router.push('/')
            return
          }
          const next = new URLSearchParams(searchParams.toString())
          next.set('intent', data.intent)
          next.delete('buyNow')
          next.delete('price')
          router.replace(`/checkout?${next.toString()}`)
        })
        .catch(() => router.push('/'))
    }
  }, [cartCount, user, authLoading, cartLoading, router, searchParams, isBuyNow])

  useEffect(() => {
    if (paymentMethod !== 'razorpay') return
    if (razorpayLoaded) return
    if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
      setRazorpayLoaded(true)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => setRazorpayLoaded(true)
    script.onerror = () => showToast('Failed to load payment gateway. Please try again or contact support.', 'error')
    document.body.appendChild(script)
  }, [paymentMethod, razorpayLoaded])

  // Digital lines never ship (no quote/serviceability) and are online-pay only.
  const hasDigital = isBuyNow ? !!rateDigital?.hasDigital : cartItems.some((i: any) => isDigitalLine(i))
  const allDigital = isBuyNow
    ? !!rateDigital?.digitalOnly
    : cartItems.length > 0 && cartItems.every((i: any) => isDigitalLine(i))

  const fetchShipping = (postalCode: string) => {
    if (isBuyNow && !buyNowItem) return
    if (!isBuyNow && allDigital) {
      setShippingCharge(0)
      setCodFee(0)
      setServiceable(true)
      return
    }
    const subtotal = isBuyNow
      ? buyNowItem!.price * buyNowItem!.qty
      : Math.max(0, getCartTotal() - digitalLinesSubtotal(cartItems as any[], gstEnabled))
    const items = isBuyNow
      ? [{ productId: buyNowItem!.productId, variantId: buyNowItem!.variantId || null, quantity: buyNowItem!.qty }]
      : cartItems
          .filter((i: any) => !isDigitalLine(i))
          .map(i => ({ productId: i.product_id, variantId: i.variant_id || null, quantity: Number(i.quantity) }))
    if (items.length === 0) return
    fetch('/api/shipping/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ destinationPin: postalCode, cartItems: items, subtotal, isCod: paymentMethod === 'cod' }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (isBuyNow && d) setRateDigital({ hasDigital: !!d.hasDigital, digitalOnly: !!d.digitalOnly })
        if (d?.charge != null) setShippingCharge(Number(d.charge))
        setCodFee(d?.codFee != null ? Number(d.codFee) : 0)
        setServiceable(d?.serviceable !== false)
      })
      .catch(() => {})
  }

  const fetchAddress = async (addressId: string, skipShipping = false) => {
    try {
      const response = await fetch('/api/user/addresses', { credentials: 'include' })
      if (response.status === 401) {
        router.push(loginPath())
        return
      }
      if (response.ok) {
        const data = await response.json()
        const selectedAddr = data.addresses.find((a: any) => a.id === addressId)
        if (selectedAddr) {
          setAddress(selectedAddr)
          if (!skipShipping) fetchShipping(selectedAddr.postal_code)
        } else {
          router.push(reviewPath)
        }
      } else {
        router.push(reviewPath)
      }
    } catch {
      router.push(reviewPath)
    } finally {
      setIsLoadingAddress(false)
    }
  }

  // Re-fetch shipping when cart items change after address is already loaded
  useEffect(() => {
    if (!address?.postal_code) return
    fetchShipping(address.postal_code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartItems])

  // Re-fetch shipping when the payment method changes — the COD handling fee
  // only applies to COD orders, so switching to/from COD changes the total.
  useEffect(() => {
    if (!address?.postal_code) return
    fetchShipping(address.postal_code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethod])

  // Keep the selected payment method valid: if the current choice becomes unavailable
  // (e.g. razorpay off, or COD disabled at site/product level), fall back to the other.
  useEffect(() => {
    const codOk =
      isCodSiteEnabled &&
      !hasDigital &&
      (isBuyNow || (cartItems.length > 0 && cartItems.every((i: any) => i.products?.is_cod_allowed !== false)))
    if (paymentMethod === 'upi' && !upiEnabled) setPaymentMethod(isRazorpayEnabled ? 'razorpay' : codOk ? 'cod' : 'upi')
    else if (paymentMethod === 'razorpay' && !isRazorpayEnabled) setPaymentMethod(upiEnabled ? 'upi' : codOk ? 'cod' : 'razorpay')
    else if (paymentMethod === 'cod' && !codOk) setPaymentMethod(upiEnabled ? 'upi' : isRazorpayEnabled ? 'razorpay' : 'cod')
    // UPI is the default; adopt it when the flag arrives after first render, unless the customer already chose.
    else if (upiEnabled && paymentMethod !== 'upi' && !payTouched.current) setPaymentMethod('upi')
  }, [paymentMethod, isRazorpayEnabled, isCodSiteEnabled, isBuyNow, cartItems, hasDigital, upiEnabled])

  // Start errors surface as toasts; the manual dialog shows its own confirm errors.
  useEffect(() => {
    if (upi.error && !upi.manual) {
      showToast(upi.error, 'error')
      upi.clearError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upi.error, upi.manual])

  useEffect(() => {
    if (!couponId) return
    const subtotal = isBuyNow ? (buyNowItem ? buyNowItem.price * buyNowItem.qty : 0) : getCartTotal()
    if (subtotal === 0) return
    fetch('/api/coupons/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ couponId, subtotal }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.discountAmount != null) {
          setDiscountAmount(Number(d.discountAmount))
          setCouponCode(d.code || null)
        }
      })
      .catch(() => {})
  }, [couponId, address, buyNowItem])

  // begin_checkout once per visit to the page, after the cart / buy-now line has loaded.
  const beganCheckout = useRef(false)
  useEffect(() => {
    if (beganCheckout.current || (intentToken && intentMode === null)) return
    if (isBuyNow) {
      if (!buyNowItem) return
      beganCheckout.current = true
      trackBeginCheckout([
        {
          sku: buyNowItem.sku,
          name: buyNowItem.productName,
          price: buyNowItem.price,
          quantity: buyNowItem.qty,
          variant: buyNowItem.subVariantName || buyNowItem.variantName,
        },
      ])
      return
    }
    if (cartLoading || cartItems.length === 0) return
    beganCheckout.current = true
    trackBeginCheckout(
      cartItems.map((i: any) => ({
        sku: i.sub_variant?.sku || i.variant?.sku || i.products?.sku,
        name: i.products?.name || '',
        price: Number(
          Number(i.price_at_addition) > 0
            ? i.price_at_addition
            : (i.sub_variant?.price ?? i.variant?.price ?? i.products?.base_price ?? 0)
        ),
        quantity: Number(i.quantity) || 1,
        variant: i.sub_variant?.sub_variant_name || i.variant?.variant_name || null,
      }))
    )
  }, [isBuyNow, buyNowItem, cartLoading, cartItems, intentToken, intentMode])

  const verifyPayment = async (
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string,
    payload: { orderId?: string; draftToken?: string }
  ) => {
    try {
      const response = await fetch('/api/razorpay/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature, ...payload }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Payment verification failed')

      try {
        sessionStorage.removeItem('rzp_pending')
      } catch {}
      clearCart()
      showToast('Payment successful!', 'success')
      window.location.href = `/account/orders/confirmation?orderId=${data.order.id}`
    } catch (err: any) {
      const msg = razorpay_payment_id
        ? `Payment received but confirmation failed. Check My Orders — if no order appears in 2 minutes, contact support with payment ID: ${razorpay_payment_id}`
        : err?.message || 'Payment verification failed. Please contact support.'
      showToast(msg, 'error')
      setIsSubmitting(false)
    }
  }

  const initiateRazorpayPayment = async (payload: { orderId?: string; draftToken?: string }) => {
    try {
      const rzpResponse = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const rzpData = await rzpResponse.json()
      if (!rzpResponse.ok) throw new Error(rzpData.error || 'Failed to initiate payment')

      const options = {
        key: rzpData.key_id ?? process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: rzpData.amount,
        currency: rzpData.currency,
        name: storeIdentity.name,
        description: 'Order Payment',
        order_id: rzpData.razorpayOrderId,
        handler: async function (response: any) {
          // Update sessionStorage with actual payment IDs before verifying
          if (payload.draftToken) {
            try {
              sessionStorage.setItem(
                'rzp_pending',
                JSON.stringify({
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                  draftToken: payload.draftToken,
                  ts: Date.now(),
                })
              )
            } catch {}
          }
          await verifyPayment(
            response.razorpay_order_id,
            response.razorpay_payment_id,
            response.razorpay_signature,
            payload
          )
        },
        prefill: {
          name: address?.full_name || '',
          email: user?.email || '',
          contact: address?.phone || '',
        },
        theme: { color: '#f97316' },
        // UPI has its own section on this page; keep it out of Checkout.
        ...(upiEnabled && { config: razorpayDisplayConfig({ hideUpi: true }) }),
        redirect: false,
        callback_url: `${window.location.origin}/checkout/payment-callback`,
        modal: {
          ondismiss: function () {
            razorpayOpen.current = false
            razorpayCleanup.current?.()
            razorpayCleanup.current = null
            try {
              sessionStorage.removeItem('rzp_pending')
            } catch {}
            if (payload.orderId) {
              fetch(`/api/orders/${payload.orderId}`, {
                method: 'DELETE',
                credentials: 'include',
                keepalive: true,
              }).catch(() => {})
            }
            setIsSubmitting(false)
            showToast('Payment cancelled — your cart is still here.', 'info')
          },
        },
      }

      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', function (response: any) {
        razorpayOpen.current = false
        razorpayCleanup.current?.()
        razorpayCleanup.current = null
        if (payload.orderId) {
          fetch(`/api/orders/${payload.orderId}/payment-failed`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ errorDescription: response.error.description }),
            keepalive: true,
          }).catch(() => {})
          window.location.href = `/account/orders/${payload.orderId}`
        } else {
          showToast(response.error?.description || 'Payment failed. Please try again.', 'error')
          setIsSubmitting(false)
        }
      })

      razorpayOpen.current = true
      if (payload.draftToken) {
        try {
          sessionStorage.setItem(
            'rzp_pending',
            JSON.stringify({
              razorpayOrderId: rzpData.razorpayOrderId,
              razorpayPaymentId: '',
              razorpaySignature: '',
              draftToken: payload.draftToken,
              ts: Date.now(),
            })
          )
        } catch {}
      }

      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (!razorpayOpen.current) return
        e.preventDefault()
        e.returnValue = ''
      }
      window.addEventListener('beforeunload', onBeforeUnload)
      razorpayCleanup.current = () => {
        window.removeEventListener('beforeunload', onBeforeUnload)
      }

      rzp.open()
    } catch (err: any) {
      if (payload.orderId) {
        await fetch(`/api/orders/${payload.orderId}/payment-failed`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ errorDescription: err.message }),
        }).catch(() => {})
        window.location.href = `/account/orders/${payload.orderId}`
      } else {
        showToast(err?.message || 'Failed to start payment', 'error')
        setIsSubmitting(false)
      }
    }
  }

  const handleCancelPreviousOrder = async () => {
    if (!existingOrder) return
    setIsCancellingPrevious(true)
    try {
      const response = await fetch(`/api/orders/${existingOrder.id}/cancel`, { method: 'POST', credentials: 'include' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to cancel order')
      setExistingOrder(null)
      setError('')
      showToast('Previous order cancelled. You can now place a new order.', 'success')
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setIsCancellingPrevious(false)
    }
  }

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    if (!address) {
      setError('Please select a delivery address')
      setIsSubmitting(false)
      return
    }

    if (!serviceable) {
      setError('Delivery is not available to this pincode. Please use a different delivery address.')
      setIsSubmitting(false)
      return
    }

    if (
      noPaymentMethod ||
      (paymentMethod === 'upi' && !upiEnabled) ||
      (paymentMethod === 'razorpay' && !isRazorpayEnabled) ||
      (paymentMethod === 'cod' && !codAvailable)
    ) {
      setError('No payment method is available for this order.')
      setIsSubmitting(false)
      return
    }

    try {
      if (paymentMethod === 'razorpay' || paymentMethod === 'upi') {
        const draftBody: any = {
          mode: isBuyNow ? 'buyNow' : 'cart',
          addressId: searchParams.get('addressId'),
          notes,
          couponId: couponId || null,
        }
        if (intentToken) {
          draftBody.intent = intentToken
        } else if (isBuyNow && buyNowItem) {
          draftBody.item = {
            productId: buyNowItem.productId,
            variantId: buyNowItem.variantId,
            subVariantId: buyNowItem.subVariantId,
            qty: buyNowItem.qty,
            buyMode: buyNowItem.buyMode,
            buyUnit: buyNowItem.buyUnit,
            price: buyNowItem.price,
          }
        }

        const draftRes = await fetch('/api/orders/draft', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draftBody),
        })
        const draftData = await draftRes.json()

        if (draftRes.status === 409 && draftData.existingOrderId) {
          setExistingOrder({ id: draftData.existingOrderId, orderNumber: draftData.existingOrderNumber })
          setError(draftData.error)
          setIsSubmitting(false)
          return
        }
        if (!draftRes.ok) throw new Error(draftData.error || 'Failed to start payment')

        if (paymentMethod === 'upi') {
          // PhonePe leaves the page; manual opens the UTR dialog (the draft commits on confirm).
          const started = await upi.start({ purpose: 'order_draft', draftToken: draftData.draftToken })
          if (!started || started.mode === 'manual') setIsSubmitting(false)
          return
        }
        await initiateRazorpayPayment({ draftToken: draftData.draftToken })
        return
      }

      const endpoint = isBuyNow ? '/api/orders/create-direct' : '/api/orders/create'
      const body: any = {
        shippingAddress: {
          fullName: address.full_name,
          addressLine1: address.address_line1,
          addressLine2: address.address_line2,
          landmark: address.landmark,
          city: address.city,
          state: address.state,
          postalCode: address.postal_code,
          country: address.country,
          phone: address.phone,
        },
        notes,
        paymentMethod,
        couponId: couponId || null,
        discountAmount: discountAmount || 0,
        shippingAmount: shippingCharge ?? 0,
        codFeeAmount: paymentMethod === 'cod' ? codFee : 0,
      }

      if (isBuyNow && buyNowItem) {
        body.item = {
          productId: buyNowItem.productId,
          variantId: buyNowItem.variantId,
          subVariantId: buyNowItem.subVariantId,
          qty: buyNowItem.qty,
          buyMode: buyNowItem.buyMode,
          buyUnit: buyNowItem.buyUnit,
          price: buyNowItem.price,
        }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (response.status === 409 && data.existingOrderId) {
        setExistingOrder({ id: data.existingOrderId, orderNumber: data.existingOrderNumber })
        setError(data.error)
        setIsSubmitting(false)
        return
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create order')
      }

      if (!isBuyNow) clearCart()
      router.push(`/account/orders/confirmation?orderId=${data.order.id}`)
    } catch (err: any) {
      showToast(err.message, 'error')
      setIsSubmitting(false)
    }
  }

  const subtotal = isBuyNow ? (buyNowItem ? buyNowItem.price * buyNowItem.qty : 0) : getCartTotal()
  const tax = isBuyNow ? 0 : getCartTax()
  const effectiveCodFee = paymentMethod === 'cod' ? codFee : 0
  const finalTotal = Math.max(0, subtotal - discountAmount + (shippingCharge ?? 0) + effectiveCodFee)

  // COD is available only when enabled at BOTH the site level AND for every item in the order.
  const codAvailable =
    isCodSiteEnabled &&
    !hasDigital &&
    (isBuyNow
      ? true // buy-now: is_cod_allowed not in intent payload, allow by default; server will validate
      : cartItems.length > 0 && cartItems.every((item: any) => item.products?.is_cod_allowed !== false))

  const noPaymentMethod = !isRazorpayEnabled && !codAvailable && !upiEnabled
  const isOnlinePay = paymentMethod === 'razorpay' || paymentMethod === 'upi'
  const submitDisabled =
    isSubmitting ||
    !serviceable ||
    (paymentMethod === 'upi' && !upiEnabled) ||
    (paymentMethod === 'razorpay' && (!isRazorpayEnabled || !razorpayLoaded)) ||
    (paymentMethod === 'cod' && !codAvailable)

  const phase: CheckoutParts['phase'] = pendingVerify
    ? 'verifying'
    : authLoading || cartLoading || isLoadingAddress || !user || (!isBuyNow && cartCount === 0) || !address
      ? 'loading'
      : 'ready'

  const retryVerify = () => {
    if (!pendingVerify) return
    setIsSubmitting(true)
    verifyPayment(pendingVerify.razorpayOrderId, pendingVerify.razorpayPaymentId, pendingVerify.razorpaySignature, {
      draftToken: pendingVerify.draftToken,
    }).finally(() => setPendingVerify(null))
  }

  const choosePayment = (v: PaymentChoice) => {
    payTouched.current = true
    setPaymentMethod(v)
  }

  const value: CheckoutParts = {
    phase,
    builtInPayment,
    retryVerify,
    user,
    cartItems,
    cartCount,
    isBuyNow,
    buyNowItem,
    gstEnabled,
    storeIdentity,
    address,
    notes,
    setNotes,
    couponCode,
    discountAmount,
    shippingCharge,
    codFee,
    serviceable,
    hasDigital,
    paymentMethod,
    choosePayment,
    isRazorpayEnabled,
    upiEnabled,
    upi,
    isSubmitting,
    setIsSubmitting,
    error,
    existingOrder,
    isCancellingPrevious,
    handleCancelPreviousOrder,
    handleSubmitOrder,
    subtotal,
    tax,
    effectiveCodFee,
    finalTotal,
    codAvailable,
    noPaymentMethod,
    isOnlinePay,
    submitDisabled,
  }
  return <CheckoutPartsContext.Provider value={value}>{children}</CheckoutPartsContext.Provider>
}

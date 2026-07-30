'use client'

import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Link from 'next/link'
import { useEffect, useState, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

function UnitLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null
  const match = label.match(/^(.+?)2$/)
  if (match) return <>{match[1]}<sup>2</sup></>
  return <>{label}</>
}

const isRazorpayEnabled = process.env.NEXT_PUBLIC_ENABLE_RAZORPAY === 'true'

export default function CheckoutPageWrapper() {
  return (
    <Suspense>
      <CheckoutPage />
    </Suspense>
  )
}

function CheckoutPage() {
  const { cartItems, cartCount, getCartTotal, getCartTax, clearCart, isLoading: cartLoading } = useCart()
  const { user, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

  const intentToken = searchParams.get('intent')
  const [intentMode, setIntentMode] = useState<'cart' | 'buyNow' | null>(null)
  const isBuyNow = intentMode === 'buyNow' || (intentMode === null && (searchParams.get('buyNow') === '1' && !intentToken))
  const couponId = searchParams.get('couponId')

  const authWasLoading = useRef(false)
  useEffect(() => {
    if (authLoading) authWasLoading.current = true
  }, [authLoading])
  const [couponCode, setCouponCode] = useState<string | null>(null)
  const [discountAmount, setDiscountAmount] = useState(0)
  const [shippingCharge, setShippingCharge] = useState<number | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [address, setAddress] = useState<any>(null)
  const [isLoadingAddress, setIsLoadingAddress] = useState(true)
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'manual' | 'cod'>(isRazorpayEnabled ? 'razorpay' : 'manual')
  const [razorpayLoaded, setRazorpayLoaded] = useState(false)
  const [existingOrder, setExistingOrder] = useState<{ id: string; orderNumber: string } | null>(null)
  const [isCancellingPrevious, setIsCancellingPrevious] = useState(false)
  const razorpayOpen = useRef(false)
  const razorpayCleanup = useRef<(() => void) | null>(null)
  const [pendingVerify, setPendingVerify] = useState<{ razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string; draftToken: string } | null>(null)

  const [buyNowItem, setBuyNowItem] = useState<{
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
  } | null>(null)

  useEffect(() => {
    // Recover payment after page reload mid-payment (e.g. 3DS opened new tab)
    try {
      const raw = sessionStorage.getItem('rzp_pending')
      if (raw) {
        const pending = JSON.parse(raw)
        const age = Date.now() - (pending.ts || 0)
        if (age < 1800_000 && pending.draftToken && pending.razorpayOrderId) {
          sessionStorage.removeItem('rzp_pending')
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
      verifyPayment(
        pendingVerify.razorpayOrderId,
        pendingVerify.razorpayPaymentId,
        pendingVerify.razorpaySignature,
        { draftToken: pendingVerify.draftToken },
      ).finally(() => setPendingVerify(null))
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
          body: JSON.stringify({ razorpayOrderId: pendingVerify.razorpayOrderId, draftToken: pendingVerify.draftToken }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.order) {
              try { sessionStorage.removeItem('rzp_pending') } catch {}
              clearCart()
              showToast('Payment confirmed!', 'success')
              window.location.href = `/account/orders/${data.order.id}`
            } else if (data.status === 'pending' && attempts < maxAttempts) {
              attempts++
              setTimeout(poll, 3000)
            } else {
              setError(data.error || 'Could not confirm payment. Check My Orders or contact support.')
              setIsSubmitting(false)
              setPendingVerify(null)
            }
          })
          .catch(() => {
            if (attempts < maxAttempts) { attempts++; setTimeout(poll, 3000) }
            else { setError('Could not confirm payment. Check My Orders or contact support.'); setIsSubmitting(false); setPendingVerify(null) }
          })
      }
      poll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!pendingVerify])
      router.push('/login?redirect=/checkout')
      return
    }

    if (!intentToken && !isBuyNow && !cartLoading && cartCount === 0 && !razorpayOpen.current) {
      router.push('/cart')
      return
    }

    const addressId = searchParams.get('addressId')

    if (intentToken) {
      fetch(`/api/checkout/intents/${encodeURIComponent(intentToken)}`, { credentials: 'include' })
        .then(async r => {
          const d = await r.json()
          if (!r.ok) { router.push('/'); return }
          if (d.mode === 'cart') {
            setIntentMode('cart')
            const intentAddressId = d.addressId || addressId
            if (!intentAddressId) { router.push('/checkout/review'); return }
            if (d.shippingCharge != null) setShippingCharge(Number(d.shippingCharge))
            fetchAddress(intentAddressId, d.shippingCharge != null)
            return
          }
          setIntentMode('buyNow')
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
              setBuyNowItem(prev => prev ? { ...prev, imageUrl: data.imageUrl || null } : prev)
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

      if (!productId) { router.push('/'); return }
      if (!addressId) { router.push('/checkout/review'); return }

      fetchAddress(addressId, false)

      // Resolve price server-side via intent — never trust URL-provided price
      fetch('/api/checkout/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ productId, variantId: variantId || null, qty, buyMode, buyUnit: buyUnit || null }),
      })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
          if (!data?.intent) { router.push('/'); return }
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
    script.onerror = () => setError('Failed to load payment gateway. Please try manual payment.')
    document.body.appendChild(script)
  }, [paymentMethod, razorpayLoaded])

  const fetchShipping = (postalCode: string) => {
    if (isBuyNow && !buyNowItem) return
    const subtotal = isBuyNow
      ? buyNowItem!.price * buyNowItem!.qty
      : getCartTotal()
    const items = isBuyNow
      ? [{ productId: buyNowItem!.productId, variantId: buyNowItem!.variantId || null, quantity: buyNowItem!.qty }]
      : cartItems.map(i => ({ productId: i.product_id, variantId: i.variant_id || null, quantity: Number(i.quantity) }))
    if (items.length === 0) return
    fetch('/api/shipping/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ destinationPin: postalCode, cartItems: items, subtotal }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.charge != null) setShippingCharge(Number(d.charge)) })
      .catch(() => {})
  }

  const fetchAddress = async (addressId: string, skipShipping = false) => {
    try {
      const response = await fetch('/api/user/addresses', { credentials: 'include' })
      if (response.status === 401) {
        router.push('/login?redirect=/checkout')
        return
      }
      if (response.ok) {
        const data = await response.json()
        const selectedAddr = data.addresses.find((a: any) => a.id === addressId)
        if (selectedAddr) {
          setAddress(selectedAddr)
          if (!skipShipping) fetchShipping(selectedAddr.postal_code)
        } else {
          router.push('/checkout/review')
        }
      } else {
        router.push('/checkout/review')
      }
    } catch {
      router.push('/checkout/review')
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

  // Re-apply coupon from server once address + subtotal are known — never trust URL value
  useEffect(() => {
    if (!couponId) return
    const subtotal = isBuyNow
      ? (buyNowItem ? buyNowItem.price * buyNowItem.qty : 0)
      : getCartTotal()
    if (subtotal === 0) return
    fetch('/api/coupons/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ couponId, subtotal }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.discountAmount != null) {
          setDiscountAmount(Number(d.discountAmount))
          setCouponCode(d.code || null)
        }
      })
      .catch(() => {})
  }, [couponId, address, buyNowItem])

  const verifyPayment = async (
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string,
    payload: { orderId?: string; draftToken?: string },
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

      try { sessionStorage.removeItem('rzp_pending') } catch {}
      clearCart()
      showToast('Payment successful!', 'success')
      window.location.href = `/account/orders/${data.order.id}`
    } catch (err: any) {
      const msg = razorpay_payment_id
        ? `Payment received but confirmation failed. Check My Orders — if no order appears in 2 minutes, contact support with payment ID: ${razorpay_payment_id}`
        : (err?.message || 'Payment verification failed. Please contact support.')
      setError(msg)
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
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
        amount: rzpData.amount,
        currency: rzpData.currency,
        name: 'Jeffi Stores',
        description: 'Order Payment',
        order_id: rzpData.razorpayOrderId,
        handler: async function (response: any) {
          // Update sessionStorage with actual payment IDs before verifying
          if (payload.draftToken) {
            try {
              sessionStorage.setItem('rzp_pending', JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
                draftToken: payload.draftToken,
                ts: Date.now(),
              }))
            } catch {}
          }
          await verifyPayment(
            response.razorpay_order_id,
            response.razorpay_payment_id,
            response.razorpay_signature,
            payload,
          )
        },
        prefill: {
          name: address?.full_name || '',
          email: user?.email || '',
          contact: address?.phone || '',
        },
        theme: { color: '#f97316' },
        redirect: false,
        callback_url: `${window.location.origin}/checkout/payment-callback`,
        modal: {
          ondismiss: function () {
            razorpayOpen.current = false
            razorpayCleanup.current?.()
            razorpayCleanup.current = null
            try { sessionStorage.removeItem('rzp_pending') } catch {}
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
          setError(response.error?.description || 'Payment failed. Please try again.')
          setIsSubmitting(false)
        }
      })

      razorpayOpen.current = true
      if (payload.draftToken) {
        try {
          sessionStorage.setItem('rzp_pending', JSON.stringify({
            razorpayOrderId: rzpData.razorpayOrderId,
            razorpayPaymentId: '',
            razorpaySignature: '',
            draftToken: payload.draftToken,
            ts: Date.now(),
          }))
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
        setError(err?.message || 'Failed to start payment')
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
      setError(err.message)
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

    try {
      if (paymentMethod === 'razorpay') {
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
      router.push(`/account/orders/${data.order.id}`)
    } catch (err: any) {
      setError(err.message)
      setIsSubmitting(false)
    }
  }

  if (pendingVerify) {
    return (
      <div className="min-h-screen bg-surface px-4 py-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-surface-elevated rounded-xl border border-border-default p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-accent-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Confirming your payment…</h2>
          <p className="text-sm text-foreground-secondary">Your payment was received. We're confirming your order — please don't close this page.</p>
          <button
            type="button"
            className="text-sm text-accent-600 hover:underline"
            onClick={() => {
              setIsSubmitting(true)
              verifyPayment(
                pendingVerify.razorpayOrderId,
                pendingVerify.razorpayPaymentId,
                pendingVerify.razorpaySignature,
                { draftToken: pendingVerify.draftToken },
              ).finally(() => setPendingVerify(null))
            }}
          >
            Retry confirmation
          </button>
        </div>
      </div>
    )
  }

  if (authLoading || cartLoading || isLoadingAddress) {
    return (
      <div className="min-h-screen bg-surface px-4 py-8">
        <div className="max-w-2xl mx-auto animate-pulse space-y-4">
          <div className="h-6 bg-surface-elevated rounded w-40" />
          <div className="h-32 bg-surface-elevated rounded-lg" />
          <div className="h-48 bg-surface-elevated rounded-lg" />
          <div className="h-24 bg-surface-elevated rounded-lg" />
        </div>
      </div>
    )
  }

  if (!user || (!isBuyNow && cartCount === 0) || !address) {
    return (
      <div className="min-h-screen bg-surface px-4 py-8">
        <div className="max-w-2xl mx-auto animate-pulse space-y-4">
          <div className="h-6 bg-surface-elevated rounded w-40" />
          <div className="h-32 bg-surface-elevated rounded-lg" />
          <div className="h-48 bg-surface-elevated rounded-lg" />
          <div className="h-24 bg-surface-elevated rounded-lg" />
        </div>
      </div>
    )
  }

  const subtotal = isBuyNow
    ? (buyNowItem ? buyNowItem.price * buyNowItem.qty : 0)
    : getCartTotal()
  const tax = isBuyNow ? 0 : getCartTax()
  const finalTotal = Math.max(0, subtotal - discountAmount + (shippingCharge ?? 0))
  const displayItems = isBuyNow ? (buyNowItem ? [buyNowItem] : []) : cartItems

  // COD is available if every item in the order allows it
  const codAvailable = isBuyNow
    ? true // buy-now: is_cod_allowed not in intent payload, allow by default; server will validate
    : cartItems.length > 0 && cartItems.every((item: any) => item.products?.is_cod_allowed !== false)

  return (
    <div className="bg-surface min-h-screen py-4 sm:py-6 lg:py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-foreground mb-4 sm:mb-6 lg:mb-8">Place Order</h1>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            <p>{error}</p>
            {existingOrder && (
              <div className="flex flex-wrap gap-3 mt-3">
                <Link
                  href={`/account/orders/${existingOrder.id}`}
                  className="inline-flex items-center px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Go to Order #{existingOrder.orderNumber}
                </Link>
                <button
                  type="button"
                  onClick={handleCancelPreviousOrder}
                  disabled={isCancellingPrevious}
                  className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:bg-red-300"
                >
                  {isCancellingPrevious ? 'Cancelling...' : 'Cancel Previous Order'}
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmitOrder}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            <div className="lg:col-span-2">
              {/* Order Items Summary */}
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-8">
                <h2 className="text-xl font-bold text-foreground mb-6">Order Items</h2>
                <div className="space-y-4">
                  {isBuyNow && buyNowItem ? (
                    <div className="flex gap-4 pb-4">
                      <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
                        {buyNowItem.imageUrl ? (
                          <ImgWithSkeleton src={buyNowItem.imageUrl} alt={buyNowItem.productName} className="w-full h-full object-cover rounded-lg" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-10 h-10 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">{buyNowItem.productName}</h3>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {buyNowItem.brandName && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-secondary text-foreground-secondary border border-border-default">
                              {buyNowItem.brandName}
                            </span>
                          )}
                          {buyNowItem.sku && <span className="text-[10px] text-foreground-muted font-mono">SKU: {buyNowItem.sku}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {buyNowItem.variantName && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700">
                              {buyNowItem.variantName}
                            </span>
                          )}
                          {buyNowItem.subVariantName && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-secondary border border-border-default">
                              {buyNowItem.subVariantName}
                            </span>
                          )}
                        </div>
                        {(() => {
                          const isBuyNowFractional = (buyNowItem.buyMode && buyNowItem.buyMode !== 'unit') || !!(buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit')
                          const effectiveBuyNowQty = isBuyNowFractional ? buyNowItem.qty : Math.round(buyNowItem.qty)
                          const buyNowTotal = buyNowItem.price * effectiveBuyNowQty
                          const displayUnit = buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit' ? buyNowItem.buyUnit : (buyNowItem.buyMode !== 'unit' ? buyNowItem.buyMode : null)
                          return (
                        <div className="flex items-center justify-between mt-2">
                          <p className="text-sm text-foreground-secondary">
                            ₹{buyNowItem.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {isBuyNowFractional ? <>{Number(Number(buyNowItem.qty).toFixed(6)).toString()}{displayUnit ? <> <UnitLabel label={displayUnit} /></> : ''}</> : effectiveBuyNowQty}
                            {buyNowItem.mrp != null && buyNowItem.mrp > buyNowItem.price && (
                              <>
                                {' '}<span className="line-through text-foreground-muted">₹{buyNowItem.mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                {' '}<span className="text-accent-600 dark:text-accent-400 font-semibold">{Math.round(((buyNowItem.mrp - buyNowItem.price) / buyNowItem.mrp) * 100)}% off</span>
                              </>
                            )}
                          </p>
                          <p className="text-sm font-semibold text-foreground">
                            ₹{buyNowTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                          )
                        })()}
                        {buyNowItem.gstPercentage != null && buyNowItem.gstPercentage > 0 && (() => {
                          const isBuyNowFractional = (buyNowItem.buyMode && buyNowItem.buyMode !== 'unit') || !!(buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit')
                          const lineTotal = buyNowItem.price * (isBuyNowFractional ? buyNowItem.qty : Math.round(buyNowItem.qty))
                          const gst = lineTotal - lineTotal / (1 + buyNowItem.gstPercentage / 100)
                          return (
                            <p className="text-[11px] text-foreground-muted mt-0.5">
                              incl. ₹{gst.toLocaleString('en-IN', { minimumFractionDigits: 3 })} GST @ {buyNowItem.gstPercentage}%
                            </p>
                          )
                        })()}
                      </div>
                    </div>
                  ) : (
                    cartItems.map((item) => {
                      const primaryImage = item.products.product_images?.find((img: any) => img.is_primary) || item.products.product_images?.[0]
                      const isFractional = item.buy_mode && item.buy_mode !== 'unit'
                      const price = isFractional ? item.price_at_addition : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
                      const effectiveQty = isFractional ? Number(item.quantity) : Math.round(Number(item.quantity))
                      const itemTotal = price * effectiveQty
                      const mrp = item.sub_variant?.mrp ?? item.variant?.mrp ?? item.products.mrp ?? null
                      const showMrp = mrp !== null && Number(mrp) > Number(price)
                      const discountPct = showMrp ? Math.round(((Number(mrp) - Number(price)) / Number(mrp)) * 100) : 0
                      const sku = item.sub_variant?.sku || item.variant?.sku || item.products.sku
                      return (
                        <div key={item.id} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0">
                          <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
                            {primaryImage ? (
                              <ImgWithSkeleton src={primaryImage.thumbnail_url} alt={item.products.name} className="w-full h-full object-cover rounded-lg" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-10 h-10 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-foreground">{item.products.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {item.products.brand_name && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-secondary text-foreground-secondary border border-border-default">
                                  {item.products.brand_name}
                                </span>
                              )}
                              {sku && <span className="text-[10px] text-foreground-muted font-mono">SKU: {sku}</span>}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.variant && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700">
                                  {item.variant.variant_name}
                                </span>
                              )}
                              {item.sub_variant && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-secondary border border-border-default">
                                  {item.sub_variant.sub_variant_name}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-foreground-secondary mt-1">
                              ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {isFractional ? <>{Number(Number(item.quantity).toFixed(6)).toString()}{item.buy_unit && item.buy_unit !== 'unit' ? <> <UnitLabel label={item.buy_unit} /></> : ''}</> : effectiveQty}
                              {showMrp && (
                                <>
                                  {' '}<span className="line-through text-foreground-muted">₹{Number(mrp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                  {' '}<span className="text-accent-600 dark:text-accent-400 font-semibold">{discountPct}% off</span>
                                </>
                              )}
                            </p>
                            <p className="text-sm font-semibold text-foreground mt-1">
                              ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Delivery Address */}
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-8">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-foreground">Delivery Address</h2>
                  <Link href="/checkout/review" className="text-accent-600 dark:text-accent-400 hover:text-accent-700 text-sm font-medium">
                    Change
                  </Link>
                </div>
                <div className="bg-surface p-4 rounded-lg">
                  <p className="font-semibold text-foreground">{address.full_name}</p>
                  <p className="text-foreground-secondary mt-2">{address.address_line1}</p>
                  {address.address_line2 && <p className="text-foreground-secondary">{address.address_line2}</p>}
                  {address.landmark && <p className="text-foreground-secondary text-sm">Landmark: {address.landmark}</p>}
                  <p className="text-foreground-secondary">{address.city}, {address.state} {address.postal_code}</p>
                  <p className="text-foreground-secondary mt-2">Phone: {address.phone}</p>
                </div>
              </div>

              {/* Order Notes */}
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-8">
                <h2 className="text-xl font-bold text-foreground mb-4">Order Notes (Optional)</h2>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                  placeholder="Any special instructions or requests..."
                />
              </div>

              {/* Payment Method */}
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-8">
                <h2 className="text-xl font-bold text-foreground mb-4">Payment Method</h2>
                <div className="space-y-3">
                  {isRazorpayEnabled && (
                    <label className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${paymentMethod === 'razorpay' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default hover:border-border-secondary'}`}>
                      <input type="radio" name="paymentMethod" value="razorpay" checked={paymentMethod === 'razorpay'} onChange={() => setPaymentMethod('razorpay')} className="w-4 h-4 text-accent-600 focus:ring-accent-500" />
                      <div className="flex-1">
                        <p className="font-semibold text-foreground">Pay Online</p>
                        <p className="text-sm text-foreground-secondary">UPI, Cards, Net Banking, Wallets</p>
                      </div>
                      <svg className="w-8 h-8 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    </label>
                  )}
                  {codAvailable && (
                    <label className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${paymentMethod === 'cod' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default hover:border-border-secondary'}`}>
                      <input type="radio" name="paymentMethod" value="cod" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} className="w-4 h-4 text-accent-600 focus:ring-accent-500" />
                      <div className="flex-1">
                        <p className="font-semibold text-foreground">Cash on Delivery</p>
                        <p className="text-sm text-foreground-secondary">Pay when your order arrives</p>
                      </div>
                      <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </label>
                  )}
                  {finalTotal >= 100000 && (
                    <label className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${paymentMethod === 'manual' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default hover:border-border-secondary'}`}>
                      <input type="radio" name="paymentMethod" value="manual" checked={paymentMethod === 'manual'} onChange={() => setPaymentMethod('manual')} className="w-4 h-4 text-accent-600 focus:ring-accent-500" />
                      <div className="flex-1">
                        <p className="font-semibold text-foreground">Request Manual Payment</p>
                        <p className="text-sm text-foreground-secondary">Our team will contact you for payment details</p>
                      </div>
                      <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                    </label>
                  )}
                </div>
              </div>

              {paymentMethod === 'manual' && finalTotal >= 100000 && (
                    <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 sm:p-6 mb-8">
                      <div className="flex gap-4">
                        <svg className="w-8 h-8 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <h3 className="text-lg font-bold text-blue-900 dark:text-blue-300 mb-2">Order Confirmation</h3>
                          <p className="text-blue-800 dark:text-blue-300">Our team will contact you shortly to confirm your order and provide payment details.</p>
                        </div>
                      </div>
                    </div>
                  )}

              {/* Trust & Security Strip */}
              <div className="mt-8 bg-surface-elevated rounded-lg border border-border-default p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-3">
                    <svg className="w-8 h-8 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Secure Checkout</p>
                      <p className="text-xs text-foreground-muted">256-bit SSL encryption</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <svg className="w-8 h-8 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Easy Returns</p>
                      <p className="text-xs text-foreground-muted">7-day return policy</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <svg className="w-8 h-8 text-accent-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Genuine Products</p>
                      <p className="text-xs text-foreground-muted">100% authentic items</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <svg className="w-8 h-8 text-foreground-secondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <div>
                      <p className="text-xs font-semibold text-foreground">24×7 Support</p>
                      <p className="text-xs text-foreground-muted">Always here to help</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Order Summary & Contact */}
            <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-20">
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
                <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-foreground-secondary">
                    <span>Subtotal{!isBuyNow ? ` (${cartCount} items)` : ''}</span>
                    <span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {!isBuyNow && (
                    <div className="flex justify-between text-foreground-muted text-sm">
                      <span>Incl. GST</span>
                      <span>₹{tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {couponCode && discountAmount > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400 text-sm font-medium">
                      <span>Coupon ({couponCode})</span>
                      <span>−₹{discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {shippingCharge != null && (
                    <div className="flex justify-between text-foreground-secondary text-sm">
                      <span>Delivery</span>
                      <span>{shippingCharge === 0 ? 'Free' : `₹${shippingCharge.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}</span>
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

                {/* Contact Information */}
                <div className="border-t border-border-default pt-6 mb-6">
                  <h3 className="font-semibold text-foreground mb-4">Contact Us</h3>
                  <div className="space-y-3 text-sm">
                    <a href="tel:+919685354099" className="flex items-center gap-3 text-foreground-secondary hover:text-accent-600 dark:hover:text-accent-400 transition-colors">
                      <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                      +91 96853 54099
                    </a>
                    <a href="mailto:jeffistoress@gmail.com" className="flex items-center gap-3 text-foreground-secondary hover:text-accent-600 dark:hover:text-accent-400 transition-colors">
                      <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      jeffistoress@gmail.com
                    </a>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || (paymentMethod === 'razorpay' && !razorpayLoaded)}
                  className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                      {paymentMethod === 'razorpay' ? 'Processing...' : 'Placing Order...'}
                    </>
                  ) : paymentMethod === 'razorpay' ? (
                    <>
                      <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Pay ₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </>
                  ) : paymentMethod === 'cod' ? (
                    <>
                      Place Order — Pay on Delivery
                      <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </>
                  ) : (
                    <>
                      Place Order
                      <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </>
                  )}
                </button>

                <Link href="/checkout/review" className="block w-full text-center text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium mt-4">
                  ← Back to Review
                </Link>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

'use client'

import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import Link from 'next/link'
import { useEffect, useState, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AddressFormModal from '@/components/visitor/AddressFormModal'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import CopySku from '@/components/ui/CopySku'
import CouponHintBanner from '@/components/visitor/CouponHintBanner'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { mrpDiscountPct, pickUnitPrice } from '@/lib/catalog/pricing'
import { round2 } from '@/lib/catalog/gst'
import { bp } from '@/lib/shared/business-path'
import CheckoutRecapSummary from '@/components/on-device/CheckoutRecapSummary'

function UnitLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null
  const match = label.match(/^(.+?)2$/)
  if (match)
    return (
      <>
        {match[1]}
        <sup>2</sup>
      </>
    )
  return <>{label}</>
}

interface CouponResult {
  couponId: string
  code: string
  description: string | null
  discountType: string
  discountValue: number
  discountAmount: number
}

function CheckoutReviewPage({ isBusiness }: { isBusiness: boolean }) {
  const { cartItems, cartCount, getCartTotal, getCartTax, clearCart, isLoading: cartLoading } = useCart()
  const { user, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()
  const isRazorpayEnabled = useStoreConfig().flags.razorpayEnabled
  const isCodSiteEnabled = useStoreConfig().flags.codEnabled
  const gstEnabled = useStoreConfig().flags.gstEnabled
  const storeName = useStoreConfig().identity.name
  const router = useRouter()
  const searchParams = useSearchParams()

  const portalHeader: Record<string, string> = isBusiness ? { 'X-Auth-Portal': 'business' } : {}
  const reviewPath = isBusiness ? bp('/business/checkout/review') : '/checkout/review'
  const cartPath = isBusiness ? bp('/business/cart') : '/cart'
  const homePath = isBusiness ? bp('/business') : '/'
  const ordersPath = isBusiness ? bp('/business/account/orders') : '/account/orders'
  const signinPath = (redirect: string) =>
    isBusiness
      ? bp(`/business/signin?redirect=${encodeURIComponent(redirect)}`)
      : `/login?redirect=${encodeURIComponent(redirect)}`

  const intentToken = searchParams.get('intent')
  const [intentMode, setIntentMode] = useState<'cart' | 'buyNow' | null>(intentToken ? 'buyNow' : null)
  const isBuyNow =
    intentMode === 'buyNow' || (intentMode === null && searchParams.get('buyNow') === '1' && !intentToken)

  const authWasLoading = useRef(false)
  const intentFetched = useRef(false)
  useEffect(() => {
    if (authLoading) authWasLoading.current = true
  }, [authLoading])

  const [selectedAddress, setSelectedAddress] = useState<any>(null)
  const [addresses, setAddresses] = useState<any[]>([])
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false)
  const [showAddressModal, setShowAddressModal] = useState(false)

  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<CouponResult | null>(null)
  const [couponError, setCouponError] = useState('')
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false)

  const [businessDiscountAmount, setBusinessDiscountAmount] = useState(0)

  const [shippingCharge, setShippingCharge] = useState<number | null>(null)
  const [shippingMeta, setShippingMeta] = useState<{
    source?: string
    freeShippingThreshold?: number
  } | null>(null)
  const [isLoadingShipping, setIsLoadingShipping] = useState(false)
  const [shippingError, setShippingError] = useState('')
  const [serviceable, setServiceable] = useState<boolean>(true)
  const [minOrderAmount, setMinOrderAmount] = useState(0)

  // Payment state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'cod' | 'manual'>(
    isRazorpayEnabled ? 'razorpay' : isBusiness ? 'manual' : 'cod'
  )
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
    extraDeliveryDays: number
  } | null>(null)

  const storageKey = isBusiness ? 'rzp_pending_biz' : 'rzp_pending'
  const callbackPath = isBusiness ? '/business/checkout/payment-callback' : '/checkout/payment-callback'

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const pending = JSON.parse(raw)
        const age = Date.now() - (pending.ts || 0)
        if (age < 1800_000 && pending.draftToken && pending.razorpayOrderId) {
          sessionStorage.removeItem(storageKey)
          setPendingVerify(
            pending.razorpayPaymentId && pending.razorpaySignature
              ? pending
              : { ...pending, razorpayPaymentId: '', razorpaySignature: '' }
          )
        } else {
          sessionStorage.removeItem(storageKey)
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (!pendingVerify) return
    if (pendingVerify.razorpayPaymentId && pendingVerify.razorpaySignature) {
      setIsSubmitting(true)
      verifyPayment(pendingVerify.razorpayOrderId, pendingVerify.razorpayPaymentId, pendingVerify.razorpaySignature, {
        draftToken: pendingVerify.draftToken,
      }).finally(() => setPendingVerify(null))
    } else {
      setIsSubmitting(true)
      const maxAttempts = 20
      let attempts = 0
      const poll = () => {
        fetch('/api/razorpay/check-pending', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...portalHeader },
          body: JSON.stringify({
            razorpayOrderId: pendingVerify.razorpayOrderId,
            draftToken: pendingVerify.draftToken,
          }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.order) {
              try {
                sessionStorage.removeItem(storageKey)
              } catch {}
              clearCart()
              showToast('Payment confirmed!', 'success')
              window.location.href = `${ordersPath}/${data.order.id}`
            } else if (data.status === 'pending' && attempts < maxAttempts) {
              attempts++
              setTimeout(poll, 3000)
            } else {
              setSubmitError(data.error || 'Could not confirm payment. Check My Orders or contact support.')
              setIsSubmitting(false)
              setPendingVerify(null)
            }
          })
          .catch(() => {
            if (attempts < maxAttempts) {
              attempts++
              setTimeout(poll, 3000)
            } else {
              setSubmitError('Could not confirm payment. Check My Orders or contact support.')
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
    fetch('/api/store-settings', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (typeof d.minOrderAmount === 'number') setMinOrderAmount(d.minOrderAmount)
      })
      .catch(() => {})
  }, [])

  const addressesFetched = useRef(false)

  useEffect(() => {
    if (user && !addressesFetched.current) {
      addressesFetched.current = true
      setIsLoadingAddresses(true)
      fetchAddresses()
    }
  }, [user])

  useEffect(() => {
    const unauthCondition = isBusiness ? !authLoading && !user && authWasLoading.current : !authLoading && !user

    if (unauthCondition) {
      const currentUrl = intentToken ? `${reviewPath}?intent=${encodeURIComponent(intentToken)}` : reviewPath
      router.push(signinPath(currentUrl))
      return
    }

    if (intentToken) {
      if (intentFetched.current) return
      intentFetched.current = true
      fetch(`/api/checkout/intents/${encodeURIComponent(intentToken)}`, {
        credentials: 'include',
        headers: { ...portalHeader },
      })
        .then(async r => {
          const d = await r.json()
          if (!r.ok) {
            router.push(homePath)
            return
          }
          if (d.mode === 'cart') {
            setIntentMode('cart')
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
            extraDeliveryDays: Number(d.extraDeliveryDays ?? 0),
          })
          if (d.businessDiscount != null && Number(d.businessDiscount) > 0) {
            setBusinessDiscountAmount(round2(Number(d.businessDiscount)))
          }
          const imageUrl = `/api/products/${d.productId}/primary-image${d.variantId ? `?variantId=${d.variantId}` : ''}`
          fetch(imageUrl, { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
              setBuyNowItem(prev => (prev ? { ...prev, imageUrl: data.imageUrl || null } : prev))
            })
            .catch(() => {})
        })
        .catch(() => router.push(homePath))
      return
    }

    if (isBuyNow) {
      const productId = searchParams.get('productId')
      const variantId = searchParams.get('variantId')
      const subVariantId = searchParams.get('subVariantId')
      const qty = parseFloat(searchParams.get('qty') || '1')
      const buyMode = searchParams.get('buyMode') || 'unit'
      const buyUnit = searchParams.get('buyUnit')

      if (!productId) {
        router.push(homePath)
        return
      }

      fetch('/api/checkout/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        credentials: 'include',
        body: JSON.stringify({
          productId,
          variantId: variantId || null,
          subVariantId: subVariantId || null,
          qty,
          buyMode,
          buyUnit: buyUnit || null,
        }),
      })
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then(data => {
          if (!data?.intent) {
            router.push(homePath)
            return
          }
          const next = new URLSearchParams(searchParams.toString())
          next.set('intent', data.intent)
          next.delete('buyNow')
          next.delete('price')
          router.replace(`${reviewPath}?${next.toString()}`)
        })
        .catch(() => router.push(homePath))
    } else if (!intentToken && !cartLoading && cartCount === 0) {
      router.replace(cartPath)
    }
  }, [cartCount, user, authLoading, cartLoading, router, isBuyNow, intentToken])

  const fetchAddresses = async () => {
    try {
      const response = await fetch('/api/user/addresses', {
        credentials: 'include',
        headers: { ...portalHeader },
      })
      if (response.ok) {
        const data = await response.json()
        setAddresses(data.addresses || [])

        const addressIdFromUrl = searchParams.get('addressId')
        if (addressIdFromUrl) {
          const addr = data.addresses.find((a: any) => a.id === addressIdFromUrl)
          if (addr) setSelectedAddress(addr)
        } else {
          const defaultAddr = data.addresses.find((a: any) => a.is_default)
          setSelectedAddress(defaultAddr || data.addresses[0] || null)
        }
      }
    } catch {
    } finally {
      setIsLoadingAddresses(false)
    }
  }

  const cartSubtotal = isBuyNow ? (buyNowItem ? buyNowItem.price * buyNowItem.qty : 0) : getCartTotal()

  // Line items for the on-device recap — works for both cart and buy-now flows.
  const recapItems = isBuyNow
    ? buyNowItem
      ? [
          {
            name: buyNowItem.variantName
              ? `${buyNowItem.productName} ${buyNowItem.variantName}`
              : buyNowItem.productName,
            category: null,
            brand: buyNowItem.brandName ?? null,
            qty: buyNowItem.qty,
          },
        ]
      : []
    : cartItems.map((it: any) => ({
        name: it.variant?.variant_name
          ? `${it.products?.name} ${it.variant.variant_name}`
          : it.products?.name || 'Item',
        category: null,
        brand: it.products?.brand_name ?? null,
        qty: Number(it.quantity) || 1,
      }))

  const belowMinimum = minOrderAmount > 0 && cartSubtotal > 0 && cartSubtotal < minOrderAmount

  useEffect(() => {
    const pin = selectedAddress?.postal_code
    if (!pin || cartSubtotal === 0) {
      setShippingCharge(null)
      setShippingMeta(null)
      setShippingError('')
      return
    }
    setIsLoadingShipping(true)
    setShippingError('')
    const items =
      isBuyNow && buyNowItem
        ? [
            {
              productId: buyNowItem.productId,
              variantId: buyNowItem.variantId,
              subVariantId: buyNowItem.subVariantId,
              quantity: buyNowItem.qty,
            },
          ]
        : cartItems.map((i: any) => ({
            productId: i.product_id,
            variantId: i.variant_id || null,
            subVariantId: i.sub_variant_id || null,
            quantity: parseFloat(i.quantity),
          }))
    fetch('/api/shipping/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      // Pass isCod so the quoted rate matches what the order route will charge —
      // Delhivery bills COD shipments differently from prepaid. Without this the
      // page shows the prepaid rate while a COD order is charged the COD rate.
      body: JSON.stringify({
        destinationPin: pin,
        cartItems: items,
        subtotal: cartSubtotal,
        isCod: paymentMethod === 'cod',
      }),
    })
      .then(r => r.json())
      .then(data => {
        setServiceable(data.serviceable !== false)
        if (data.serviceable === false) {
          setShippingCharge(null)
          setShippingMeta(null)
          setShippingError('Delivery is not available to this pincode.')
        } else if (data.charge != null) {
          setShippingCharge(data.charge)
          setShippingMeta({ source: data.source, freeShippingThreshold: data.freeShippingThreshold })
        } else setShippingError(data.error || 'Unavailable')
      })
      .catch(() => setShippingError('Could not fetch rate'))
      .finally(() => setIsLoadingShipping(false))
  }, [selectedAddress?.postal_code, cartSubtotal, paymentMethod])

  const [edd, setEdd] = useState<string | null>(null)
  const [isLoadingEdd, setIsLoadingEdd] = useState(false)

  useEffect(() => {
    const pin = selectedAddress?.postal_code
    if (!pin) {
      setEdd(null)
      return
    }
    const extraDays = isBuyNow
      ? (buyNowItem?.extraDeliveryDays ?? 0)
      : Math.max(0, ...cartItems.map((i: any) => Number(i.products?.extra_delivery_days ?? 0)))
    setIsLoadingEdd(true)
    fetch(`/api/products/edd?pin=${pin}&extraDays=${extraDays}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.edd) setEdd(data.edd)
      })
      .catch(() => {})
      .finally(() => setIsLoadingEdd(false))
  }, [selectedAddress?.postal_code, isBuyNow, buyNowItem?.extraDeliveryDays, cartItems])

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return
    setIsApplyingCoupon(true)
    setCouponError('')
    try {
      const res = await fetch('/api/coupons/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        credentials: 'include',
        body: JSON.stringify({ code: couponCode, subtotal: cartSubtotal }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCouponError(data.error || 'Invalid coupon')
        setAppliedCoupon(null)
      } else {
        setAppliedCoupon(data)
        setCouponError('')
      }
    } catch {
      setCouponError('Failed to apply coupon')
    } finally {
      setIsApplyingCoupon(false)
    }
  }

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null)
    setCouponCode('')
    setCouponError('')
  }

  const discountAmount = appliedCoupon?.discountAmount ?? 0

  useEffect(() => {
    const codeFromUrl = searchParams.get('couponCode')
    if (!codeFromUrl || appliedCoupon || cartSubtotal === 0) return
    setCouponCode(codeFromUrl)
    fetch('/api/coupons/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...portalHeader },
      credentials: 'include',
      body: JSON.stringify({ code: codeFromUrl, subtotal: cartSubtotal }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.couponId) setAppliedCoupon(data)
      })
      .catch(() => {})
  }, [searchParams, cartSubtotal])

  useEffect(() => {
    if (!isBusiness || !user) return
    if (isBuyNow) {
      if (!buyNowItem) return
      fetch('/api/business/discount-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Portal': 'business' },
        credentials: 'include',
        body: JSON.stringify({
          mode: 'buyNow',
          productId: buyNowItem.productId,
          variantId: buyNowItem.variantId,
          subVariantId: buyNowItem.subVariantId,
          qty: buyNowItem.qty,
          price: buyNowItem.price,
        }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (d?.businessDiscountAmount != null) setBusinessDiscountAmount(d.businessDiscountAmount)
        })
        .catch(() => {})
    } else {
      if (cartCount === 0) return
      fetch('/api/business/discount-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Portal': 'business' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'cart' }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (d?.businessDiscountAmount != null) setBusinessDiscountAmount(d.businessDiscountAmount)
        })
        .catch(() => {})
    }
  }, [isBusiness, user, isBuyNow, buyNowItem, cartCount])

  const finalTotal = Math.max(0, cartSubtotal - discountAmount - businessDiscountAmount + (shippingCharge ?? 0))

  // COD shows only when enabled at BOTH the site level AND for every item; never for B2B.
  const codAvailable =
    !isBusiness &&
    isCodSiteEnabled &&
    (isBuyNow ? true : cartItems.length > 0 && cartItems.every((item: any) => item.products?.is_cod_allowed !== false))

  // Business buyers can always fall back to manual (contact-for-payment), so B2B never
  // hits the no-payment state. Consumer storefront has no manual option.
  const manualAvailable = isBusiness
  const noPaymentMethod = !isRazorpayEnabled && !codAvailable && !manualAvailable

  // Reset payment method if the selected option becomes unavailable.
  useEffect(() => {
    if (paymentMethod === 'razorpay' && !isRazorpayEnabled) {
      setPaymentMethod(codAvailable ? 'cod' : manualAvailable ? 'manual' : 'razorpay')
    } else if (paymentMethod === 'cod' && !codAvailable) {
      setPaymentMethod(isRazorpayEnabled ? 'razorpay' : manualAvailable ? 'manual' : 'cod')
    } else if (paymentMethod === 'manual' && !manualAvailable) {
      setPaymentMethod(isRazorpayEnabled ? 'razorpay' : codAvailable ? 'cod' : 'manual')
    }
  }, [codAvailable, isRazorpayEnabled, manualAvailable])

  // Load Razorpay script when razorpay payment method is selected
  useEffect(() => {
    if (!isRazorpayEnabled) return
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
    script.onerror = () => setSubmitError('Failed to load payment gateway. Please try again or contact support.')
    document.body.appendChild(script)
  }, [paymentMethod, razorpayLoaded])

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
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        body: JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature, ...payload }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Payment verification failed')
      try {
        sessionStorage.removeItem(storageKey)
      } catch {}
      clearCart()
      showToast('Payment successful!', 'success')
      window.location.href = `${ordersPath}/${data.order.id}`
    } catch (err: any) {
      const msg = razorpay_payment_id
        ? `Payment received but confirmation failed. Check My Orders — if no order appears in 2 minutes, contact support with payment ID: ${razorpay_payment_id}`
        : err?.message || 'Payment verification failed. Please contact support.'
      setSubmitError(msg)
      setIsSubmitting(false)
    }
  }

  const initiateRazorpayPayment = async (payload: { orderId?: string; draftToken?: string }) => {
    try {
      const rzpResponse = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        body: JSON.stringify(payload),
      })
      const rzpData = await rzpResponse.json()
      if (!rzpResponse.ok) throw new Error(rzpData.error || 'Failed to initiate payment')

      const options = {
        key: rzpData.key_id ?? process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: rzpData.amount,
        currency: rzpData.currency,
        name: storeName,
        description: 'Order Payment',
        order_id: rzpData.razorpayOrderId,
        handler: async function (response: any) {
          if (payload.draftToken) {
            try {
              sessionStorage.setItem(
                storageKey,
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
          razorpayCleanup.current?.()
          razorpayCleanup.current = null
          await verifyPayment(
            response.razorpay_order_id,
            response.razorpay_payment_id,
            response.razorpay_signature,
            payload
          )
        },
        prefill: {
          name: selectedAddress?.full_name || '',
          email: user?.email || '',
          contact: selectedAddress?.phone || '',
        },
        theme: { color: '#f97316' },
        redirect: false,
        callback_url: `${window.location.origin}${callbackPath}`,
        modal: {
          ondismiss: function () {
            razorpayOpen.current = false
            razorpayCleanup.current?.()
            razorpayCleanup.current = null
            try {
              sessionStorage.removeItem(storageKey)
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
          window.location.href = `${ordersPath}/${payload.orderId}`
        } else {
          setSubmitError(response.error?.description || 'Payment failed. Please try again.')
          setIsSubmitting(false)
        }
      })

      razorpayOpen.current = true
      if (payload.draftToken) {
        try {
          sessionStorage.setItem(
            storageKey,
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
        window.location.href = `${ordersPath}/${payload.orderId}`
      } else {
        setSubmitError(err?.message || 'Failed to start payment')
        setIsSubmitting(false)
      }
    }
  }

  const handleCancelPreviousOrder = async () => {
    if (!existingOrder) return
    setIsCancellingPrevious(true)
    try {
      const response = await fetch(`/api/orders/${existingOrder.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...portalHeader },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to cancel order')
      setExistingOrder(null)
      setSubmitError('')
      showToast('Previous order cancelled. You can now place a new order.', 'success')
    } catch (err: any) {
      setSubmitError(err.message)
    } finally {
      setIsCancellingPrevious(false)
    }
  }

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError('')

    if (!selectedAddress) {
      showToast('Please select a delivery address', 'warning')
      return
    }
    if (belowMinimum) {
      showToast(
        `Minimum order value is ₹${minOrderAmount}. Add ₹${(minOrderAmount - cartSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })} more to proceed.`,
        'warning'
      )
      return
    }
    if (!serviceable) {
      showToast('Delivery is not available to this pincode. Please use a different delivery address.', 'warning')
      return
    }
    if (
      noPaymentMethod ||
      (paymentMethod === 'razorpay' && !isRazorpayEnabled) ||
      (paymentMethod === 'cod' && !codAvailable) ||
      (paymentMethod === 'manual' && !manualAvailable)
    ) {
      showToast('No payment method is available for this order.', 'warning')
      return
    }

    setIsSubmitting(true)

    try {
      if (paymentMethod === 'razorpay') {
        const draftBody: any = {
          mode: isBuyNow ? 'buyNow' : 'cart',
          addressId: selectedAddress.id,
          notes,
          couponId: appliedCoupon?.couponId || null,
          ...(isBusiness && { portal: 'business' }),
        }
        if (isBuyNow && !intentToken) {
          setSubmitError('Checkout session expired. Please go back and try again.')
          setIsSubmitting(false)
          return
        }
        if (intentToken) {
          draftBody.intent = intentToken
        }

        const draftRes = await fetch('/api/orders/draft', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...portalHeader },
          body: JSON.stringify(draftBody),
        })
        const draftData = await draftRes.json()

        if (draftRes.status === 409 && draftData.existingOrderId) {
          setExistingOrder({ id: draftData.existingOrderId, orderNumber: draftData.existingOrderNumber })
          setSubmitError(draftData.error)
          setIsSubmitting(false)
          return
        }
        if (!draftRes.ok) throw new Error(draftData.error || 'Failed to start payment')

        await initiateRazorpayPayment({ draftToken: draftData.draftToken })
        return
      }

      // COD path (server confirms unpaid at placement; razorpay is handled above)
      const endpoint = isBuyNow ? '/api/orders/create-direct' : '/api/orders/create'
      const body: any = {
        shippingAddress: {
          fullName: selectedAddress.full_name,
          addressLine1: selectedAddress.address_line1,
          addressLine2: selectedAddress.address_line2,
          landmark: selectedAddress.landmark,
          city: selectedAddress.city,
          state: selectedAddress.state,
          postalCode: selectedAddress.postal_code,
          country: selectedAddress.country,
          phone: selectedAddress.phone,
        },
        notes,
        paymentMethod,
        couponId: appliedCoupon?.couponId || null,
        discountAmount: (appliedCoupon?.discountAmount || 0) + businessDiscountAmount,
        shippingAmount: shippingCharge ?? 0,
      }

      if (isBuyNow && !intentToken) {
        setSubmitError('Checkout session expired. Please go back and try again.')
        setIsSubmitting(false)
        return
      }
      if (intentToken) {
        body.intent = intentToken
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        body: JSON.stringify(body),
      })
      const data = await response.json()

      if (response.status === 409 && data.existingOrderId) {
        setExistingOrder({ id: data.existingOrderId, orderNumber: data.existingOrderNumber })
        setSubmitError(data.error)
        setIsSubmitting(false)
        return
      }
      if (!response.ok) throw new Error(data.error || 'Failed to create order')

      if (!isBuyNow) clearCart()
      router.push(`${ordersPath}/${data.order.id}`)
    } catch (err: any) {
      setSubmitError(err.message)
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
          <p className="text-sm text-foreground-secondary">
            Your payment was received. We&apos;re confirming your order — please don&apos;t close this page.
          </p>
          {submitError && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-3">
              {submitError}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (authLoading || cartLoading || (intentToken && isBuyNow && !buyNowItem)) {
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

  if (!user) return null
  if (!intentToken && !isBuyNow && cartCount === 0) return null

  const tax = isBuyNow ? 0 : getCartTax()

  return (
    <div className="bg-surface min-h-screen py-4 sm:py-6 lg:py-8">
      <div className="container mx-auto px-4">
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <h1 className="text-3xl font-bold text-foreground">Order Review</h1>
          <p className="text-foreground-secondary mt-2">Review your order details before placing the order</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* On-device AI cart recap (silent unless the device is capable) */}
            <CheckoutRecapSummary items={recapItems} total={cartSubtotal} />
            {/* Delivery Address */}
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-foreground">Delivery Address</h2>
                <button
                  onClick={() => setShowAddressModal(true)}
                  className="text-accent-600 dark:text-accent-400 hover:text-accent-700 text-sm font-medium"
                >
                  + Add New Address
                </button>
              </div>

              {isLoadingAddresses ? (
                <div className="space-y-3">
                  {[1, 2].map(i => (
                    <div key={i} className="h-20 bg-surface rounded-lg animate-pulse border border-border-default" />
                  ))}
                </div>
              ) : addresses.length === 0 ? (
                <div className="text-center py-8">
                  <svg
                    className="w-16 h-16 text-foreground-muted mx-auto mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <p className="text-foreground-secondary mb-4">No saved addresses found</p>
                  <button
                    onClick={() => setShowAddressModal(true)}
                    className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    Add Delivery Address
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {addresses.map(address => (
                    <label
                      key={address.id}
                      className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        selectedAddress?.id === address.id
                          ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30'
                          : 'border-border-default hover:border-border-secondary'
                      }`}
                    >
                      <input
                        type="radio"
                        name="address"
                        checked={selectedAddress?.id === address.id}
                        onChange={() => setSelectedAddress(address)}
                        className="mt-1 w-4 h-4 text-accent-600 focus:ring-accent-500"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground">{address.full_name}</span>
                          {address.is_default && (
                            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-2 py-0.5 rounded">
                              Default
                            </span>
                          )}
                          <span className="text-xs bg-surface-secondary text-foreground-secondary px-2 py-0.5 rounded capitalize">
                            {address.address_type}
                          </span>
                        </div>
                        <p className="text-foreground-secondary text-sm">
                          {address.address_line1}
                          {address.address_line2 && `, ${address.address_line2}`}
                        </p>
                        {address.landmark && (
                          <p className="text-foreground-secondary text-sm">Landmark: {address.landmark}</p>
                        )}
                        <p className="text-foreground-secondary text-sm">
                          {address.city}, {address.state} {address.postal_code}
                        </p>
                        <p className="text-foreground-secondary text-sm mt-1">Phone: {address.phone}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Order Items */}
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <h2 className="text-xl font-bold text-foreground mb-6">
                {isBuyNow ? 'Item' : `Order Items (${cartCount} ${cartCount === 1 ? 'item' : 'items'})`}
              </h2>

              <div className="space-y-4">
                {isBuyNow && !buyNowItem ? (
                  <div className="flex gap-4 pb-4">
                    <div className="w-20 h-20 bg-surface rounded-lg animate-pulse border border-border-default flex-shrink-0" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-4 bg-surface rounded animate-pulse w-3/4" />
                      <div className="h-3 bg-surface rounded animate-pulse w-1/2" />
                      <div className="h-3 bg-surface rounded animate-pulse w-1/3" />
                    </div>
                  </div>
                ) : isBuyNow && buyNowItem ? (
                  <div className="flex gap-4 pb-4">
                    <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
                      {buyNowItem.imageUrl ? (
                        <ImgWithSkeleton
                          src={buyNowItem.imageUrl}
                          alt={buyNowItem.productName}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg
                            className="w-10 h-10 text-foreground-muted"
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
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground">{buyNowItem.productName}</h3>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {buyNowItem.brandName && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-secondary text-foreground-secondary border border-border-default">
                            {buyNowItem.brandName}
                          </span>
                        )}
                        {buyNowItem.sku && (
                          <span className="text-[10px] text-foreground-muted font-mono">
                            SKU: {buyNowItem.sku}
                            <CopySku sku={buyNowItem.sku} className="ml-1" />
                          </span>
                        )}
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
                        const isFractional =
                          (buyNowItem.buyMode && buyNowItem.buyMode !== 'unit') ||
                          !!(buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit')
                        const effectiveQty = isFractional ? buyNowItem.qty : Math.round(buyNowItem.qty)
                        const lineTotal = buyNowItem.price * effectiveQty
                        const displayUnit =
                          buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit'
                            ? buyNowItem.buyUnit
                            : buyNowItem.buyMode !== 'unit'
                              ? buyNowItem.buyMode
                              : null
                        return (
                          <div className="mt-2">
                            <p className="text-sm text-foreground-secondary">
                              ₹{buyNowItem.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ×{' '}
                              {isFractional ? (
                                <>
                                  {Number(Number(buyNowItem.qty).toFixed(6)).toString()}
                                  {displayUnit ? (
                                    <>
                                      {' '}
                                      <UnitLabel label={displayUnit} />
                                    </>
                                  ) : (
                                    ''
                                  )}
                                </>
                              ) : (
                                effectiveQty
                              )}
                              {buyNowItem.mrp != null && buyNowItem.mrp > buyNowItem.price && (
                                <>
                                  {' '}
                                  <span className="line-through text-foreground-muted">
                                    ₹{buyNowItem.mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  </span>{' '}
                                  <span className="text-accent-600 dark:text-accent-400 font-semibold">
                                    {mrpDiscountPct(buyNowItem.mrp, buyNowItem.price)}% off
                                  </span>
                                </>
                              )}
                            </p>
                            <p className="text-sm font-semibold text-foreground mt-0.5">
                              ₹{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        )
                      })()}
                      {gstEnabled &&
                        buyNowItem.gstPercentage != null &&
                        buyNowItem.gstPercentage > 0 &&
                        (() => {
                          const isFractional =
                            (buyNowItem.buyMode && buyNowItem.buyMode !== 'unit') ||
                            !!(buyNowItem.buyUnit && buyNowItem.buyUnit !== 'unit')
                          const lineTotal =
                            buyNowItem.price * (isFractional ? buyNowItem.qty : Math.round(buyNowItem.qty))
                          const gst = lineTotal - lineTotal / (1 + buyNowItem.gstPercentage / 100)
                          return (
                            <p className="text-[11px] text-foreground-muted mt-0.5">
                              incl. ₹{gst.toLocaleString('en-IN', { minimumFractionDigits: 3 })} GST @{' '}
                              {buyNowItem.gstPercentage}%
                            </p>
                          )
                        })()}
                    </div>
                  </div>
                ) : (
                  cartItems.map(item => {
                    const primaryImage =
                      item.products.product_images?.find((img: any) => img.is_primary) ||
                      item.products.product_images?.[0]
                    const isCustomQty = item.buy_mode && item.buy_mode !== 'unit'
                    const price = !gstEnabled
                      ? pickUnitPrice(
                          {
                            inclusive: item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price,
                            exGst:
                              item.sub_variant?.price_ex_gst ??
                              item.variant?.price_ex_gst ??
                              item.products.price_ex_gst,
                          },
                          false
                        )
                      : isCustomQty
                        ? item.price_at_addition
                        : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
                    const effectiveQty = isCustomQty ? Number(item.quantity) : Math.round(Number(item.quantity))
                    const itemTotal = price * effectiveQty
                    const mrp = item.sub_variant?.mrp ?? item.variant?.mrp ?? item.products.mrp ?? null
                    const showMrp = mrp !== null && Number(mrp) > Number(price)
                    const discountPct = showMrp ? mrpDiscountPct(Number(mrp), Number(price)) : 0
                    const sku = item.sub_variant?.sku || item.variant?.sku || item.products.sku
                    const gstRate = Number(item.products.gst_percentage || 0)
                    const itemGst = gstRate > 0 ? itemTotal - itemTotal / (1 + gstRate / 100) : 0
                    const unitLabel =
                      item.cart_item_unit?.display_label ?? item.cart_item_unit?.unit ?? item.buy_unit ?? null
                    const showUnitLabel = !!item.buy_unit && item.buy_unit !== 'unit'

                    return (
                      <div key={item.id} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0">
                        <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
                          {primaryImage ? (
                            <ImgWithSkeleton
                              src={primaryImage.thumbnail_url || primaryImage.image_url}
                              alt={item.products.name}
                              blurhash={primaryImage.blurhash}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg
                                className="w-10 h-10 text-foreground-muted"
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
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground">{item.products.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {item.products.brand_name && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-secondary text-foreground-secondary border border-border-default">
                                {item.products.brand_name}
                              </span>
                            )}
                            {sku && (
                              <span className="text-[10px] text-foreground-muted font-mono">
                                SKU: {sku}
                                <CopySku sku={sku} className="ml-1" />
                              </span>
                            )}
                            <ProductWarningBadges
                              fragile={item.products?.fragile}
                              hazardous={item.products?.hazardous}
                              flammable={item.products?.flammable}
                              size="xs"
                            />
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
                          <div className="mt-2">
                            <p className="text-sm text-foreground-secondary">
                              ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              {isCustomQty ? (
                                <>
                                  {' '}
                                  / <UnitLabel label={unitLabel ?? item.buy_unit} />
                                </>
                              ) : showUnitLabel ? (
                                <>
                                  {' '}
                                  / <UnitLabel label={unitLabel} />
                                </>
                              ) : (
                                ''
                              )}{' '}
                              ×{' '}
                              {isCustomQty ? (
                                <>
                                  {Number(Number(item.quantity).toFixed(6)).toString()}
                                  {unitLabel || item.buy_unit ? (
                                    <>
                                      {' '}
                                      <UnitLabel label={unitLabel ?? item.buy_unit} />
                                    </>
                                  ) : (
                                    ''
                                  )}
                                </>
                              ) : (
                                <>
                                  {effectiveQty}
                                  {showUnitLabel ? (
                                    <>
                                      {' '}
                                      <UnitLabel label={unitLabel} />
                                    </>
                                  ) : (
                                    ''
                                  )}
                                </>
                              )}
                              {showMrp && (
                                <>
                                  {' '}
                                  <span className="line-through text-foreground-muted">
                                    ₹{Number(mrp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  </span>{' '}
                                  <span className="text-accent-600 dark:text-accent-400 font-semibold">
                                    {discountPct}% off
                                  </span>
                                </>
                              )}
                            </p>
                            <p className="text-sm font-semibold text-foreground mt-0.5">
                              ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          {gstRate > 0 && (
                            <p className="text-[11px] text-foreground-muted mt-0.5">
                              incl. ₹{itemGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} GST @ {gstRate}%
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {!isBuyNow && (
                <Link
                  href={cartPath}
                  className="block text-center text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium mt-4"
                >
                  ← Modify Cart
                </Link>
              )}
            </div>

            {/* Expected Delivery Date */}
            <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6">
              <div className="flex items-start gap-4">
                <svg
                  className="w-8 h-8 text-accent-500 flex-shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2.293 2.293a1 1 0 001.414 0L9 16h4zm0 0l1-4 3 1 1 3M13 6h5l3 4v6h-2"
                  />
                </svg>
                <div className="flex-1">
                  {!selectedAddress ? (
                    <p className="text-sm text-foreground-muted">
                      Select a delivery address to see expected delivery date
                    </p>
                  ) : isLoadingEdd ? (
                    <div className="h-5 w-48 bg-border-default rounded animate-pulse" />
                  ) : edd ? (
                    <>
                      <p className="text-sm text-foreground-secondary">Expected Delivery</p>
                      <p className="text-lg font-semibold text-foreground">
                        {new Date(edd + 'T00:00:00').toLocaleDateString('en-IN', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                        })}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-foreground-muted">Delivery date unavailable for this pincode</p>
                  )}
                </div>
              </div>
            </div>

            {/* Delivery Promise */}
            <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6">
              <div className="flex items-start gap-4">
                <svg
                  className="w-8 h-8 text-accent-500 flex-shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">Our Delivery Promise</h3>
                  <ul className="space-y-1.5 text-sm text-foreground-secondary">
                    <li className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Orders placed before 5 PM are dispatched the same day
                    </li>
                    <li className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Tracked shipment with SMS &amp; email updates
                    </li>
                    <li className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Secure packaging to ensure safe delivery
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Order Summary Sidebar */}
          <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-24">
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <h2 className="text-xl font-bold text-foreground mb-6">Order Summary</h2>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-foreground-secondary">
                  <span>Subtotal{!isBuyNow ? ` (${cartCount} items)` : ''}</span>
                  <span>₹{cartSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                {!isBuyNow && gstEnabled && (
                  <div className="flex justify-between text-foreground-muted text-sm">
                    <span>Incl. GST</span>
                    <span>₹{tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {appliedCoupon && (
                  <div className="flex justify-between text-green-600 dark:text-green-400 text-sm font-medium">
                    <span>Coupon ({appliedCoupon.code})</span>
                    <span>−₹{appliedCoupon.discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {businessDiscountAmount > 0 && (
                  <div className="flex justify-between text-green-600 dark:text-green-400 text-sm font-medium">
                    <span>Business Discount</span>
                    <span>−₹{businessDiscountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-foreground-secondary">
                  <span>Delivery Charges</span>
                  {isLoadingShipping ? (
                    <span className="text-foreground-muted text-sm animate-pulse">Calculating...</span>
                  ) : shippingError ? (
                    <span className="text-yellow-600 dark:text-yellow-400 text-sm">Unavailable</span>
                  ) : shippingCharge != null ? (
                    shippingCharge === 0 ? (
                      <span className="font-medium text-green-600 dark:text-green-400">Free</span>
                    ) : (
                      <span className="font-medium">
                        ₹{shippingCharge.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    )
                  ) : (
                    <span className="text-foreground-muted text-sm">Select address</span>
                  )}
                </div>
                {shippingCharge === 0 && shippingMeta && (
                  <>
                    {shippingMeta.source === 'free_threshold' && shippingMeta.freeShippingThreshold && (
                      <div className="text-xs text-green-600 dark:text-green-400 -mt-1">
                        Free delivery on orders above ₹{shippingMeta.freeShippingThreshold.toLocaleString('en-IN')}
                      </div>
                    )}
                    {shippingMeta.source === 'admin_disabled' && (
                      <div className="text-xs text-green-600 dark:text-green-400 -mt-1">
                        Free delivery on every order
                      </div>
                    )}
                  </>
                )}
                <div className="border-t border-border-default pt-3">
                  <div className="flex justify-between text-xl font-bold text-foreground">
                    <span>Total</span>
                    <span>₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {gstEnabled && <p className="text-xs text-foreground-muted mt-1">Price inclusive of all taxes</p>}
                </div>
              </div>

              {/* Coupon */}
              <div className="mb-6">
                {appliedCoupon ? (
                  <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                        {appliedCoupon.code}
                      </span>
                      {appliedCoupon.description && (
                        <p className="text-xs text-green-600 dark:text-green-500">{appliedCoupon.description}</p>
                      )}
                    </div>
                    <button
                      onClick={handleRemoveCoupon}
                      className="text-xs text-red-500 hover:text-red-600 font-medium ml-3"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div>
                    <CouponHintBanner />
                    <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Have a coupon?</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponCode}
                        onChange={e => {
                          setCouponCode(e.target.value.toUpperCase())
                          setCouponError('')
                        }}
                        onKeyDown={e => e.key === 'Enter' && handleApplyCoupon()}
                        placeholder="Enter code"
                        className="flex-1 px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                      />
                      <button
                        onClick={handleApplyCoupon}
                        disabled={isApplyingCoupon || !couponCode.trim()}
                        className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed"
                      >
                        {isApplyingCoupon ? '...' : 'Apply'}
                      </button>
                    </div>
                    {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
                  </div>
                )}
              </div>

              {belowMinimum && (
                <p className="text-xs text-red-500 mb-3 text-center font-medium">
                  Minimum order ₹{minOrderAmount} — add ₹
                  {(minOrderAmount - cartSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })} more to
                  proceed.
                </p>
              )}

              {/* Order Notes */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                  Order Notes (Optional)
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  placeholder="Any special instructions..."
                />
              </div>

              {/* Payment Method */}
              <div className="mb-4 space-y-2">
                <p className="text-sm font-medium text-foreground-secondary">Payment Method</p>
                {isRazorpayEnabled && (
                  <label
                    className={`flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all ${paymentMethod === 'razorpay' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default hover:border-border-secondary'}`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="razorpay"
                      checked={paymentMethod === 'razorpay'}
                      onChange={() => setPaymentMethod('razorpay')}
                      className="w-4 h-4 text-accent-600 focus:ring-accent-500"
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Pay Online</p>
                      <p className="text-xs text-foreground-secondary">UPI, Cards, Net Banking</p>
                    </div>
                  </label>
                )}
                {codAvailable && (
                  <label
                    className={`flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all ${paymentMethod === 'cod' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default hover:border-border-secondary'}`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="cod"
                      checked={paymentMethod === 'cod'}
                      onChange={() => setPaymentMethod('cod')}
                      className="w-4 h-4 text-accent-600 focus:ring-accent-500"
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Cash on Delivery</p>
                      <p className="text-xs text-foreground-secondary">Pay when your order arrives</p>
                    </div>
                  </label>
                )}
                {manualAvailable && (
                  <label
                    className={`flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all ${paymentMethod === 'manual' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default hover:border-border-secondary'}`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="manual"
                      checked={paymentMethod === 'manual'}
                      onChange={() => setPaymentMethod('manual')}
                      className="w-4 h-4 text-accent-600 focus:ring-accent-500"
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Contact for Payment</p>
                      <p className="text-xs text-foreground-secondary">Our team will reach out to arrange payment</p>
                    </div>
                  </label>
                )}
                {paymentMethod === 'manual' && manualAvailable && (
                  <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                    Your order will be placed as unpaid. Our team will contact you to confirm the payment arrangement
                    before dispatch.
                  </div>
                )}
                {noPaymentMethod && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    No payment method is available for this order.
                  </p>
                )}
                {!serviceable && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Delivery is not available to this pincode. Please use a different delivery address.
                  </p>
                )}
              </div>

              {submitError && (
                <div className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 rounded-lg text-sm">
                  <p>{submitError}</p>
                  {existingOrder && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Link
                        href={`${ordersPath}/${existingOrder.id}`}
                        className="inline-flex items-center px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        Go to Order #{existingOrder.orderNumber}
                      </Link>
                      <button
                        type="button"
                        onClick={handleCancelPreviousOrder}
                        disabled={isCancellingPrevious}
                        className="inline-flex items-center px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors disabled:bg-red-300"
                      >
                        {isCancellingPrevious ? 'Cancelling...' : 'Cancel Previous Order'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {noPaymentMethod ? (
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
                  We are unable to accept orders right now due to a technical issue. Please try again later or contact
                  support.
                </div>
              ) : (
                <form onSubmit={handleSubmitOrder}>
                  <button
                    type="submit"
                    disabled={
                      !selectedAddress ||
                      addresses.length === 0 ||
                      belowMinimum ||
                      isLoadingShipping ||
                      !serviceable ||
                      (paymentMethod === 'cod' && !codAvailable) ||
                      (shippingCharge === null && !shippingError) ||
                      isSubmitting ||
                      (paymentMethod === 'razorpay' && isRazorpayEnabled && !razorpayLoaded)
                    }
                    className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                        {paymentMethod === 'razorpay' ? 'Processing...' : 'Placing Order...'}
                      </>
                    ) : isLoadingShipping ? (
                      <>
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                        Calculating delivery…
                      </>
                    ) : paymentMethod === 'razorpay' && isRazorpayEnabled ? (
                      <>
                        <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                          />
                        </svg>
                        Pay ₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </>
                    ) : paymentMethod === 'cod' ? (
                      <>
                        Place Order — Pay on Delivery
                        <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                          />
                        </svg>
                      </>
                    ) : paymentMethod === 'manual' ? (
                      <>
                        Place Order — Contact for Payment
                        <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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
                </form>
              )}

              {isBuyNow ? (
                <button
                  onClick={() => router.back()}
                  className="block w-full text-center text-foreground-secondary hover:text-foreground font-medium mt-4"
                >
                  ← Go Back
                </button>
              ) : (
                <Link
                  href={cartPath}
                  className="block w-full text-center text-foreground-secondary hover:text-foreground font-medium mt-4"
                >
                  ← Back to Cart
                </Link>
              )}

              <div className="mt-6 pt-6 border-t border-border-default">
                <div className="flex items-center gap-2 text-sm text-foreground-secondary">
                  <svg
                    className="w-5 h-5 text-green-600 dark:text-green-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                  <span>Secure Checkout</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <AddressFormModal
          isOpen={showAddressModal}
          onClose={() => setShowAddressModal(false)}
          onSaved={newAddress => {
            setShowAddressModal(false)
            fetchAddresses()
            setSelectedAddress(newAddress)
          }}
          {...(isBusiness ? { portalHeader: 'business' } : {})}
        />
      </div>
    </div>
  )
}

export function CheckoutReviewPageVisitorWrapper() {
  return (
    <Suspense>
      <CheckoutReviewPage isBusiness={false} />
    </Suspense>
  )
}

export function CheckoutReviewPageBusinessWrapper() {
  return (
    <Suspense>
      <CheckoutReviewPage isBusiness={true} />
    </Suspense>
  )
}

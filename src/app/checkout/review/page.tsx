'use client'

import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Link from 'next/link'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AddressFormModal from '@/components/visitor/AddressFormModal'
import CouponHintBanner from '@/components/visitor/CouponHintBanner'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

export default function CheckoutReviewPageWrapper() {
  return (
    <Suspense>
      <CheckoutReviewPage />
    </Suspense>
  )
}

interface CouponResult {
  couponId: string
  code: string
  description: string | null
  discountType: string
  discountValue: number
  discountAmount: number
}

function CheckoutReviewPage() {
  const { cartItems, cartCount, getCartTotal, getCartTax, isLoading: cartLoading } = useCart()
  const { user, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

  const isBuyNow = searchParams.get('buyNow') === '1'

  const [selectedAddress, setSelectedAddress] = useState<any>(null)
  const [addresses, setAddresses] = useState<any[]>([])
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(true)
  const [showAddressModal, setShowAddressModal] = useState(false)

  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<CouponResult | null>(null)
  const [couponError, setCouponError] = useState('')
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false)

  const [shippingCharge, setShippingCharge] = useState<number | null>(null)
  const [isLoadingShipping, setIsLoadingShipping] = useState(false)
  const [shippingError, setShippingError] = useState('')
  const [minOrderAmount, setMinOrderAmount] = useState(0)

  const [buyNowItem, setBuyNowItem] = useState<{
    productId: string
    variantId: string | null
    qty: number
    buyMode: string
    buyUnit: string | null
    price: number
    productName: string
    variantName: string | null
    imageUrl: string | null
  } | null>(null)

  useEffect(() => {
    fetch('/api/store-settings').then(r => r.json()).then(d => {
      if (typeof d.minOrderAmount === 'number') setMinOrderAmount(d.minOrderAmount)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/checkout/review')
      return
    }

    if (isBuyNow) {
      const productId = searchParams.get('productId')
      const variantId = searchParams.get('variantId')
      const qty = parseFloat(searchParams.get('qty') || '1')
      const buyMode = searchParams.get('buyMode') || 'unit'
      const buyUnit = searchParams.get('buyUnit')
      const price = parseFloat(searchParams.get('price') || '0')
      const productName = searchParams.get('productName') || ''
      const variantName = searchParams.get('variantName')

      if (!productId || !price) { router.push('/'); return }

      setBuyNowItem({
        productId,
        variantId: variantId || null,
        qty,
        buyMode,
        buyUnit: buyUnit || null,
        price,
        productName,
        variantName: variantName || null,
        imageUrl: null,
      })

      fetch(`/api/products/${productId}/primary-image`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.imageUrl) {
            setBuyNowItem(prev => prev ? { ...prev, imageUrl: data.imageUrl } : prev)
          }
        })
        .catch(() => {})
    } else if (!cartLoading && cartCount === 0) {
      router.push('/cart')
    }

    if (user) {
      fetchAddresses()
    }
  }, [cartCount, user, authLoading, cartLoading, router, isBuyNow])

  const fetchAddresses = async () => {
    try {
      const response = await fetch('/api/user/addresses')
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

  const cartSubtotal = isBuyNow
    ? (buyNowItem ? buyNowItem.price * buyNowItem.qty : 0)
    : getCartTotal()

  const belowMinimum = minOrderAmount > 0 && cartSubtotal > 0 && cartSubtotal < minOrderAmount

  useEffect(() => {
    const pin = selectedAddress?.postal_code
    if (!pin || cartSubtotal === 0) {
      setShippingCharge(null)
      setShippingError('')
      return
    }
    setIsLoadingShipping(true)
    setShippingError('')
    const items = isBuyNow && buyNowItem
      ? [{ productId: buyNowItem.productId, variantId: buyNowItem.variantId, quantity: buyNowItem.qty }]
      : cartItems.map((i: any) => ({ productId: i.product_id, variantId: i.variant_id || null, quantity: parseFloat(i.quantity) }))
    fetch('/api/shipping/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ destinationPin: pin, cartItems: items }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.charge != null) setShippingCharge(data.charge)
        else setShippingError(data.error || 'Unavailable')
      })
      .catch(() => setShippingError('Could not fetch rate'))
      .finally(() => setIsLoadingShipping(false))
  }, [selectedAddress?.postal_code, cartSubtotal])

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return
    setIsApplyingCoupon(true)
    setCouponError('')
    try {
      const res = await fetch('/api/coupons/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code: codeFromUrl, subtotal: cartSubtotal }),
    })
      .then(r => r.json())
      .then(data => { if (data.couponId) setAppliedCoupon(data) })
      .catch(() => {})
  }, [searchParams, cartSubtotal])

  const finalTotal = Math.max(0, cartSubtotal - discountAmount + (shippingCharge ?? 0))

  const handleProceedToCheckout = () => {
    if (!selectedAddress) {
      showToast('Please select a delivery address', 'warning')
      return
    }
    if (belowMinimum) {
      showToast(`Minimum order value is ₹${minOrderAmount}. Add ₹${(minOrderAmount - cartSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })} more to proceed.`, 'warning')
      return
    }

    const params = new URLSearchParams({ addressId: selectedAddress.id })
    if (appliedCoupon) {
      params.set('couponId', appliedCoupon.couponId)
      params.set('couponCode', appliedCoupon.code)
      params.set('discountAmount', String(appliedCoupon.discountAmount))
    }
    if (shippingCharge != null) {
      params.set('shippingCharge', String(shippingCharge))
    }
    if (isBuyNow && buyNowItem) {
      params.set('buyNow', '1')
      params.set('productId', buyNowItem.productId)
      if (buyNowItem.variantId) params.set('variantId', buyNowItem.variantId)
      params.set('qty', String(buyNowItem.qty))
      params.set('buyMode', buyNowItem.buyMode)
      if (buyNowItem.buyUnit) params.set('buyUnit', buyNowItem.buyUnit)
      params.set('price', String(buyNowItem.price))
    }
    router.push(`/checkout?${params.toString()}`)
  }

  if (authLoading || cartLoading || isLoadingAddresses) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (!user) return null
  if (!isBuyNow && cartCount === 0) return null

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

              {addresses.length === 0 ? (
                <div className="text-center py-8">
                  <svg className="w-16 h-16 text-foreground-muted mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
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
                  {addresses.map((address) => (
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
                            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-2 py-0.5 rounded">Default</span>
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
                      {buyNowItem.variantName && <p className="text-sm text-foreground-muted">{buyNowItem.variantName}</p>}
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-foreground-secondary">
                          ₹{buyNowItem.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {buyNowItem.buyMode === 'weight' || buyNowItem.buyMode === 'length' ? `${buyNowItem.qty.toFixed(3)} ${buyNowItem.buyUnit ?? ''}` : Math.round(buyNowItem.qty)}
                        </p>
                        <p className="text-sm font-semibold text-foreground">
                          ₹{(buyNowItem.price * buyNowItem.qty).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  cartItems.map((item) => {
                    const primaryImage = item.products.product_images?.find((img: any) => img.is_primary) || item.products.product_images?.[0]
                    const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
                    const itemTotal = price * item.quantity

                    return (
                      <div key={item.id} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0">
                        <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
                          {primaryImage ? (
                            <ImgWithSkeleton src={primaryImage.thumbnail_url || primaryImage.image_url} alt={item.products.name} className="w-full h-full object-cover rounded-lg" />
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
                          {item.variant && <p className="text-sm text-foreground-muted">{item.variant.variant_name}</p>}
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-sm text-foreground-secondary">
                              ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {item.buy_mode === 'weight' || item.buy_mode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}` : Math.round(Number(item.quantity))}
                            </p>
                            <p className="text-sm font-semibold text-foreground">
                              ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {!isBuyNow && (
                <Link href="/cart" className="block text-center text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium mt-4">
                  ← Modify Cart
                </Link>
              )}
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
                {!isBuyNow && (
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
                <div className="flex justify-between text-foreground-secondary">
                  <span>Delivery Charges</span>
                  {isLoadingShipping ? (
                    <span className="text-foreground-muted text-sm animate-pulse">Calculating...</span>
                  ) : shippingError ? (
                    <span className="text-yellow-600 dark:text-yellow-400 text-sm">Unavailable</span>
                  ) : shippingCharge != null ? (
                    <span className="font-medium">₹{shippingCharge.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  ) : (
                    <span className="text-foreground-muted text-sm">Select address</span>
                  )}
                </div>
                <div className="border-t border-border-default pt-3">
                  <div className="flex justify-between text-xl font-bold text-foreground">
                    <span>Total</span>
                    <span>₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <p className="text-xs text-foreground-muted mt-1">Price inclusive of all taxes</p>
                </div>
              </div>

              {/* Coupon */}
              <div className="mb-6">
                {appliedCoupon ? (
                  <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm font-semibold text-green-700 dark:text-green-400">{appliedCoupon.code}</span>
                      {appliedCoupon.description && (
                        <p className="text-xs text-green-600 dark:text-green-500">{appliedCoupon.description}</p>
                      )}
                    </div>
                    <button onClick={handleRemoveCoupon} className="text-xs text-red-500 hover:text-red-600 font-medium ml-3">Remove</button>
                  </div>
                ) : (
                  <div>
                    <CouponHintBanner />
                    <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Have a coupon?</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponCode}
                        onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponError('') }}
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
                  Minimum order ₹{minOrderAmount} — add ₹{(minOrderAmount - cartSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })} more to proceed.
                </p>
              )}
              <button
                onClick={handleProceedToCheckout}
                disabled={!selectedAddress || addresses.length === 0 || belowMinimum}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center"
              >
                Proceed to Place Order
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>

              <Link href="/cart" className="block w-full text-center text-foreground-secondary hover:text-foreground font-medium mt-4">
                ← Back to Cart
              </Link>

              <div className="mt-6 pt-6 border-t border-border-default">
                <div className="flex items-center gap-2 text-sm text-foreground-secondary">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
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
          onSaved={(newAddress) => {
            setShowAddressModal(false)
            fetchAddresses()
            setSelectedAddress(newAddress)
          }}
        />
      </div>
    </div>
  )
}

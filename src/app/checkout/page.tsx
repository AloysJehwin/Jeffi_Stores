'use client'

import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Link from 'next/link'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

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

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [address, setAddress] = useState<any>(null)
  const [isLoadingAddress, setIsLoadingAddress] = useState(true)
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'manual'>(
    isRazorpayEnabled ? 'razorpay' : 'manual'
  )
  const [razorpayLoaded, setRazorpayLoaded] = useState(false)
  const [existingOrder, setExistingOrder] = useState<{ id: string; orderNumber: string } | null>(null)
  const [isCancellingPrevious, setIsCancellingPrevious] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/checkout')
      return
    }

    if (!cartLoading && cartCount === 0) {
      router.push('/cart')
      return
    }

    const addressId = searchParams.get('addressId')
    if (!addressId) {
      router.push('/checkout/review')
      return
    }

    fetchAddress(addressId)
  }, [cartCount, user, authLoading, cartLoading, router, searchParams])

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

  const fetchAddress = async (addressId: string) => {
    try {
      const response = await fetch('/api/user/addresses')
      if (response.ok) {
        const data = await response.json()
        const selectedAddr = data.addresses.find((a: any) => a.id === addressId)
        if (selectedAddr) {
          setAddress(selectedAddr)
        } else {
          router.push('/checkout/review')
        }
      }
    } catch {
      router.push('/checkout/review')
    } finally {
      setIsLoadingAddress(false)
    }
  }

  const verifyPayment = async (
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string,
    orderId: string,
  ) => {
    try {
      const response = await fetch('/api/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Payment verification failed')

      clearCart()
      showToast('Payment successful!', 'success')
      window.location.href = `/account/orders/${orderId}`
    } catch (err: any) {
      setError('Payment received but verification failed. Please contact support — your payment is safe.')
      setIsSubmitting(false)
    }
  }

  const initiateRazorpayPayment = async (orderId: string, totalAmount: number) => {
    try {
      const rzpResponse = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
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
          await verifyPayment(
            response.razorpay_order_id,
            response.razorpay_payment_id,
            response.razorpay_signature,
            orderId,
          )
        },
        prefill: {
          name: address?.full_name || '',
          email: user?.email || '',
          contact: address?.phone || '',
        },
        theme: { color: '#f97316' },
        modal: {
          ondismiss: function () {
            clearCart()
            window.location.href = `/account/orders/${orderId}`
          },
        },
      }

      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', function (response: any) {
        fetch(`/api/orders/${orderId}/payment-failed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ errorDescription: response.error.description }),
        }).catch(() => {})
        clearCart()
        window.location.href = `/account/orders/${orderId}`
      })
      rzp.open()
    } catch (err: any) {
      setError(err.message)
      setIsSubmitting(false)
    }
  }

  const handleCancelPreviousOrder = async () => {
    if (!existingOrder) return
    setIsCancellingPrevious(true)
    try {
      const response = await fetch(`/api/orders/${existingOrder.id}/cancel`, { method: 'POST' })
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
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
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

      if (paymentMethod === 'razorpay' && data.requiresPayment) {
        await initiateRazorpayPayment(data.order.id, parseFloat(data.order.total))
      } else {
        clearCart()
        router.push(`/account/orders/${data.order.id}`)
      }
    } catch (err: any) {
      setError(err.message)
      setIsSubmitting(false)
    }
  }

  if (authLoading || cartLoading || isLoadingAddress) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (!user || cartCount === 0 || !address) {
    return null
  }

  const total = getCartTotal()
  const tax = getCartTax()

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
            {/* Order Items Summary */}
            <div className="lg:col-span-2">
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-8">
              <h2 className="text-xl font-bold text-foreground mb-6">Order Items</h2>

              <div className="space-y-4">
                {cartItems.map((item) => {
                  const primaryImage = item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
                  const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
                  const itemTotal = price * item.quantity

                  return (
                    <div key={item.id} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0">
                      <div className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden flex-shrink-0 border border-border-default">
                        {primaryImage ? (
                          <img
                            src={primaryImage.thumbnail_url}
                            alt={item.products.name}
                            className="w-full h-full object-cover rounded-lg"
                          />
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
                        {item.variant && (
                          <p className="text-sm text-foreground-muted">{item.variant.variant_name}</p>
                        )}
                        <p className="text-sm text-foreground-secondary mt-1">
                          ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {item.buy_mode === 'weight' || item.buy_mode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}` : item.quantity}
                        </p>
                        <p className="text-sm font-semibold text-foreground mt-1">
                          ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Delivery Address */}
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-foreground">Delivery Address</h2>
                <Link
                  href="/checkout/review"
                  className="text-accent-600 dark:text-accent-400 hover:text-accent-700 text-sm font-medium"
                >
                  Change
                </Link>
              </div>
              <div className="bg-surface p-4 rounded-lg">
                <p className="font-semibold text-foreground">{address.full_name}</p>
                <p className="text-foreground-secondary mt-2">{address.address_line1}</p>
                {address.address_line2 && <p className="text-foreground-secondary">{address.address_line2}</p>}
                {address.landmark && <p className="text-foreground-secondary text-sm">Landmark: {address.landmark}</p>}
                <p className="text-foreground-secondary">
                  {address.city}, {address.state} {address.postal_code}
                </p>
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
                  <label
                    className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      paymentMethod === 'razorpay'
                        ? 'border-accent-500 bg-accent-50'
                        : 'border-border-default hover:border-border-secondary'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="razorpay"
                      checked={paymentMethod === 'razorpay'}
                      onChange={() => setPaymentMethod('razorpay')}
                      className="w-4 h-4 text-accent-600 focus:ring-accent-500"
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">Pay Online</p>
                      <p className="text-sm text-foreground-secondary">UPI, Cards, Net Banking, Wallets</p>
                    </div>
                    <svg className="w-8 h-8 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </label>
                )}
                <label
                  className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    paymentMethod === 'manual'
                      ? 'border-accent-500 bg-accent-50'
                      : 'border-border-default hover:border-border-secondary'
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="manual"
                    checked={paymentMethod === 'manual'}
                    onChange={() => setPaymentMethod('manual')}
                    className="w-4 h-4 text-accent-600 focus:ring-accent-500"
                  />
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">Request Manual Payment</p>
                    <p className="text-sm text-foreground-secondary">Our team will contact you for payment details</p>
                  </div>
                  <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </label>
              </div>
            </div>

            {/* Payment Information (manual only) */}
            {paymentMethod === 'manual' && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 sm:p-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-blue-900 dark:text-blue-300 mb-2">Order Confirmation</h3>
                    <p className="text-blue-800 dark:text-blue-300">
                      Our team will contact you shortly to confirm your order and provide payment details.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Order Summary & Contact */}
          <div className="lg:col-span-1 lg:self-start lg:sticky lg:top-24">
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
                <div className="border-t border-border-default pt-3">
                  <div className="flex justify-between text-lg font-bold text-foreground">
                    <span>Total</span>
                    <span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <p className="text-xs text-foreground-muted mt-1">Price inclusive of all taxes</p>
                </div>
              </div>

              {/* Contact Information */}
              <div className="border-t border-border-default pt-6 mb-6">
                <h3 className="font-semibold text-foreground mb-4">Contact Us</h3>
                <div className="space-y-3 text-sm">
                  <a
                    href="tel:+918903031299"
                    className="flex items-center gap-3 text-foreground-secondary hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                  >
                    <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    +91 89030 31299
                  </a>
                  <a
                    href="tel:+919488354099"
                    className="flex items-center gap-3 text-foreground-secondary hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                  >
                    <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    +91 94883 54099
                  </a>
                  <a
                    href="mailto:jeffistoress@gmail.com"
                    className="flex items-center gap-3 text-foreground-secondary hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                  >
                    <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
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
                    Pay ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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

              <Link
                href="/checkout/review"
                className="block w-full text-center text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium mt-4"
              >
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

'use client'

import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function CheckoutPage() {
  const { cartItems, cartCount, getCartTotal, clearCart, isLoading: cartLoading } = useCart()
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [address, setAddress] = useState<any>(null)
  const [isLoadingAddress, setIsLoadingAddress] = useState(true)
  const [notes, setNotes] = useState('')

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
    } catch (error) {
      console.error('Failed to fetch address:', error)
      router.push('/checkout/review')
    } finally {
      setIsLoadingAddress(false)
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
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create order')
      }

      clearCart()
      router.push(`/account/orders/confirmation?orderId=${data.order.id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (authLoading || cartLoading || isLoadingAddress) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (!user || cartCount === 0 || !address) {
    return null
  }

  const total = getCartTotal()

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Place Order</h1>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmitOrder}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Delivery Address */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-gray-900">Delivery Address</h2>
                  <Link
                    href="/checkout/review"
                    className="text-accent-600 hover:text-accent-700 text-sm font-medium"
                  >
                    Change
                  </Link>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="font-semibold text-gray-900">{address.full_name}</p>
                  <p className="text-gray-700 mt-2">{address.address_line1}</p>
                  {address.address_line2 && <p className="text-gray-700">{address.address_line2}</p>}
                  {address.landmark && <p className="text-gray-600 text-sm">Landmark: {address.landmark}</p>}
                  <p className="text-gray-700">
                    {address.city}, {address.state} {address.postal_code}
                  </p>
                  <p className="text-gray-600 mt-2">Phone: {address.phone}</p>
                </div>
              </div>

              {/* Order Items */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Order Items</h2>
                <div className="space-y-4">
                  {cartItems.map((item) => {
                    const primaryImage = item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
                    const price = item.products.sale_price || item.products.base_price
                    const itemTotal = price * item.quantity

                    return (
                      <div key={item.id} className="flex gap-4 pb-4 border-b border-gray-200 last:border-b-0">
                        <div className="w-20 h-20 bg-white rounded-lg overflow-hidden flex-shrink-0 border border-gray-200">
                          {primaryImage ? (
                            <img
                              src={primaryImage.thumbnail_url}
                              alt={item.products.name}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900">{item.products.name}</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {item.quantity}
                          </p>
                          <p className="text-sm font-semibold text-gray-900 mt-1">
                            ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Order Notes */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Order Notes (Optional)</h2>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                  placeholder="Any special instructions or requests..."
                />
              </div>

              {/* Payment Information */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-blue-900 mb-2">Order Confirmation</h3>
                    <p className="text-blue-800">
                      Our team will contact you shortly to confirm your order and provide payment details.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Order Summary Sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sticky top-24">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Order Summary</h2>
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal ({cartCount} items)</span>
                    <span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="border-t border-gray-200 pt-3">
                    <div className="flex justify-between text-lg font-bold text-gray-900">
                      <span>Total</span>
                      <span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                      Placing Order...
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
                  className="block w-full text-center text-accent-600 hover:text-accent-700 font-medium mt-4"
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

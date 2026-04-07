'use client'

import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Link from 'next/link'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function CheckoutReviewPageWrapper() {
  return (
    <Suspense>
      <CheckoutReviewPage />
    </Suspense>
  )
}

function CheckoutReviewPage() {
  const { cartItems, cartCount, getCartTotal, getCartTax, isLoading: cartLoading } = useCart()
  const { user, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [selectedAddress, setSelectedAddress] = useState<any>(null)
  const [addresses, setAddresses] = useState<any[]>([])
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/checkout/review')
      return
    }
    
    if (!cartLoading && cartCount === 0) {
      router.push('/cart')
    }

    // Load user addresses
    if (user) {
      fetchAddresses()
    }
  }, [cartCount, user, authLoading, cartLoading, router])

  const fetchAddresses = async () => {
    try {
      const response = await fetch('/api/user/addresses')
      if (response.ok) {
        const data = await response.json()
        setAddresses(data.addresses || [])
        
        // Pre-select default address or first address
        const addressIdFromUrl = searchParams.get('addressId')
        if (addressIdFromUrl) {
          const addr = data.addresses.find((a: any) => a.id === addressIdFromUrl)
          if (addr) setSelectedAddress(addr)
        } else {
          const defaultAddr = data.addresses.find((a: any) => a.is_default)
          setSelectedAddress(defaultAddr || data.addresses[0] || null)
        }
      }
    } catch (error) {
      console.error('Failed to fetch addresses:', error)
    } finally {
      setIsLoadingAddresses(false)
    }
  }

  const handleProceedToCheckout = () => {
    if (!selectedAddress) {
      showToast('Please select a delivery address', 'warning')
      return
    }
    router.push(`/checkout?addressId=${selectedAddress.id}`)
  }

  if (authLoading || cartLoading || isLoadingAddresses) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (!user || cartCount === 0) {
    return null
  }

  const total = getCartTotal()
  const tax = getCartTax()

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="container mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Order Review</h1>
          <p className="text-gray-600 mt-2">Review your order details before placing the order</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Delivery Address */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-900">Delivery Address</h2>
                <Link
                  href="/account/addresses"
                  className="text-accent-600 hover:text-accent-700 text-sm font-medium"
                >
                  + Add New Address
                </Link>
              </div>

              {addresses.length === 0 ? (
                <div className="text-center py-8">
                  <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <p className="text-gray-600 mb-4">No saved addresses found</p>
                  <Link
                    href="/account/addresses"
                    className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    Add Delivery Address
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {addresses.map((address) => (
                    <label
                      key={address.id}
                      className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        selectedAddress?.id === address.id
                          ? 'border-accent-500 bg-accent-50'
                          : 'border-gray-200 hover:border-gray-300'
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
                          <span className="font-semibold text-gray-900">{address.full_name}</span>
                          {address.is_default && (
                            <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">Default</span>
                          )}
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded capitalize">
                            {address.address_type}
                          </span>
                        </div>
                        <p className="text-gray-700 text-sm">
                          {address.address_line1}
                          {address.address_line2 && `, ${address.address_line2}`}
                        </p>
                        {address.landmark && (
                          <p className="text-gray-600 text-sm">Landmark: {address.landmark}</p>
                        )}
                        <p className="text-gray-700 text-sm">
                          {address.city}, {address.state} {address.postal_code}
                        </p>
                        <p className="text-gray-600 text-sm mt-1">Phone: {address.phone}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Order Items */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">
                Order Items ({cartCount} {cartCount === 1 ? 'item' : 'items'})
              </h2>

              <div className="space-y-4">
                {cartItems.map((item) => {
                  const primaryImage = item.products.product_images?.find(img => img.is_primary) || item.products.product_images?.[0]
                  const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
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
                        {item.variant && (
                          <p className="text-sm text-gray-500">{item.variant.variant_name}</p>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <p className="text-sm text-gray-600">
                            ₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {item.quantity}
                          </p>
                          <p className="text-sm font-semibold text-gray-900">
                            ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <Link
                href="/cart"
                className="block text-center text-accent-600 hover:text-accent-700 font-medium mt-4"
              >
                ← Modify Cart
              </Link>
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
                <div className="flex justify-between text-gray-500 text-sm">
                  <span>Incl. GST</span>
                  <span>₹{tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Delivery Charges</span>
                  <span className="text-green-600">FREE</span>
                </div>
                <div className="border-t border-gray-200 pt-3">
                  <div className="flex justify-between text-xl font-bold text-gray-900">
                    <span>Total</span>
                    <span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Price inclusive of all taxes</p>
                </div>
              </div>

              <button
                onClick={handleProceedToCheckout}
                disabled={!selectedAddress || addresses.length === 0}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center"
              >
                Proceed to Place Order
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>

              <Link
                href="/cart"
                className="block w-full text-center text-gray-600 hover:text-gray-700 font-medium mt-4"
              >
                ← Back to Cart
              </Link>

              {/* Security Badge */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>Secure Checkout</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

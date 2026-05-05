'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface OrderDetails {
  id: string
  orderNumber: string
  totalAmount: number
  status: string
  createdAt: string
  shippingAddress: {
    addressLine1: string
    addressLine2?: string
    city: string
    state: string
    postalCode: string
    phone: string
  }
  items: Array<{
    id: string
    productName: string
    quantity: number
    unitPrice: number
    totalPrice: number
    buyMode?: string
    buyUnit?: string | null
  }>
}

export default function OrderConfirmationPageWrapper() {
  return (
    <Suspense>
      <OrderConfirmationPage />
    </Suspense>
  )
}

function OrderConfirmationPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const orderId = searchParams.get('orderId')

  const [order, setOrder] = useState<OrderDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orderId) {
      router.push('/account/orders')
      return
    }

    const fetchOrder = async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch order details')
        }
        const data = await response.json()
        setOrder(data.order)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }

    fetchOrder()
  }, [orderId, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="bg-surface-elevated p-4 sm:p-6 lg:p-8 rounded-lg shadow-md max-w-md w-full text-center">
          <div className="text-red-500 text-5xl mb-4">!</div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Order Not Found</h1>
          <p className="text-foreground-secondary mb-6">{error || 'Unable to load order details'}</p>
          <Link
            href="/account/orders"
            className="inline-block bg-accent-600 text-white px-6 py-2 rounded-lg hover:bg-accent-700 transition-colors"
          >
            View All Orders
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface min-h-screen py-12">
      <div className="container mx-auto px-4 max-w-3xl">
        {/* Success Message */}
        <div className="bg-green-50 dark:bg-green-900/30 border-2 border-green-200 dark:border-green-800 rounded-lg p-4 sm:p-6 lg:p-8 mb-8 text-center">
          <div className="text-green-500 text-6xl mb-4">✓</div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Order Confirmed!</h1>
          <p className="text-foreground-secondary mb-4">
            Thank you for your purchase. Your order has been successfully placed.
          </p>
          <div className="bg-surface-elevated rounded-lg p-4 inline-block">
            <p className="text-sm text-foreground-secondary mb-1">Order Number</p>
            <p className="text-2xl font-bold text-accent-600 dark:text-accent-400">{order.orderNumber}</p>
          </div>
        </div>

        {/* Order Summary */}
        <div className="bg-surface-elevated rounded-lg shadow-md p-4 sm:p-6 mb-6">
          <h2 className="text-xl font-bold text-foreground mb-4">Order Summary</h2>

          <div className="space-y-4 mb-6">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between items-center pb-4 border-b border-border-default last:border-b-0">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{item.productName}</p>
                  <p className="text-sm text-foreground-secondary">Quantity: {item.buyMode === 'weight' || item.buyMode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buyUnit ?? ''}` : Math.round(Number(item.quantity))}</p>
                </div>
                <p className="font-semibold text-foreground">
                  ₹{(item.unitPrice * item.quantity).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t-2 border-border-default pt-4">
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold text-foreground">Total</span>
              <span className="text-2xl font-bold text-accent-600 dark:text-accent-400">
                ₹{order.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Shipping Address */}
        <div className="bg-surface-elevated rounded-lg shadow-md p-4 sm:p-6 mb-6">
          <h2 className="text-xl font-bold text-foreground mb-4">Shipping Address</h2>
          <div className="text-foreground-secondary">
            <p>{order.shippingAddress.addressLine1}</p>
            {order.shippingAddress.addressLine2 && (
              <p>{order.shippingAddress.addressLine2}</p>
            )}
            <p>
              {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
            </p>
            <p className="mt-2">Phone: {order.shippingAddress.phone}</p>
          </div>
        </div>

        {/* Order Status */}
        <div className="bg-surface-elevated rounded-lg shadow-md p-4 sm:p-6 mb-8">
          <h2 className="text-xl font-bold text-foreground mb-4">Order Status</h2>
          <div className="flex items-center gap-3">
            <span className={`px-4 py-2 rounded-full font-semibold ${
              order.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
              order.status === 'processing' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' :
              order.status === 'shipped' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300' :
              order.status === 'out_for_delivery' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300' :
              order.status === 'delivered' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
              'bg-surface-secondary text-foreground'
            }`}>
              {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
            </span>
            <span className="text-foreground-secondary">
              Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          </div>
        </div>

        {/* Confirmation Email Notice */}
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-8">
          <p className="text-blue-900 dark:text-blue-300 text-sm">
            A confirmation email has been sent to your email address with your order details.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/account/orders"
            className="flex-1 bg-accent-600 text-white px-6 py-3 rounded-lg hover:bg-accent-700 transition-colors text-center font-semibold"
          >
            View All Orders
          </Link>
          <Link
            href="/"
            className="flex-1 bg-surface-elevated text-foreground-secondary px-6 py-3 rounded-lg border-2 border-border-secondary hover:bg-surface-secondary transition-colors text-center font-semibold"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  )
}

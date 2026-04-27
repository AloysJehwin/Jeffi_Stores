'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import AccountSidebar, { navItems } from '@/components/visitor/AccountSidebar'

interface OrderItem {
  id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  products: {
    slug: string
    product_images: Array<{
      thumbnail_url: string
      is_primary: boolean
    }>
  }
}

interface Order {
  id: string
  order_number: string
  created_at: string
  status: string
  payment_status: string
  total_amount: number
  subtotal: number
  addresses: {
    address_line1: string
    address_line2?: string
    city: string
    state: string
    postal_code: string
  }
  order_items: OrderItem[]
}

export default function OrdersPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login?redirect=/account/orders')
    }
    if (user) {
      fetchOrders()
    }
  }, [user, isLoading, router])

  const fetchOrders = async () => {
    try {
      const response = await fetch('/api/orders')
      if (response.ok) {
        const data = await response.json()
        setOrders(data.orders || [])
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  const handleCancelOrder = async (orderId: string) => {
    setCancellingOrderId(orderId)
    try {
      await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' })
      await fetchOrders()
    } catch {
    } finally {
      setCancellingOrderId(null)
      setConfirmCancelId(null)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
      case 'confirmed':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
      case 'shipped':
        return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
      case 'delivered':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
      case 'cancel_requested':
        return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
      case 'cancelled':
        return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
      default:
        return 'bg-surface-secondary text-foreground'
    }
  }

  if (isLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-foreground-secondary">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="bg-surface min-h-screen">

      {/* Mobile header */}
      <div className="lg:hidden bg-accent-500 pt-8 pb-16 px-4">
        <h1 className="text-lg font-semibold text-white/80 mb-4">My Account</h1>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white flex-shrink-0">
            {user.firstName?.[0]?.toUpperCase() || 'U'}
          </div>
          <div>
            <p className="text-xl font-bold text-white">{user.firstName} {user.lastName}</p>
            <p className="text-sm text-white/70 mt-0.5">{user.email}</p>
          </div>
        </div>
      </div>

      {/* Mobile nav tabs */}
      <div className="lg:hidden relative z-10 mx-4 -mt-8 mb-4">
        <div className="bg-surface-elevated rounded-xl shadow-md border border-border-default overflow-hidden">
          <div className="flex">
            {navItems.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors border-b-2 ${
                    isActive
                      ? 'text-accent-600 border-accent-500 dark:text-accent-400'
                      : 'text-foreground-muted border-transparent'
                  }`}
                >
                  <span className={isActive ? 'text-accent-500' : 'text-foreground-muted'}>{item.icon}</span>
                  <span className="leading-tight text-center" style={{ fontSize: '10px' }}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 pb-16 lg:py-8 lg:pb-8">
        <div className="hidden lg:block mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">My Orders</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Sidebar */}
          <div className="hidden lg:block lg:col-span-1">
            <AccountSidebar />
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {orders.length === 0 ? (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
                <svg
                  className="w-16 h-16 text-foreground-muted mx-auto mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                  />
                </svg>
                <h3 className="text-xl font-semibold text-foreground mb-2">No orders yet</h3>
                <p className="text-foreground-secondary mb-6">You haven&apos;t placed any orders yet.</p>
                <Link
                  href="/products"
                  className="inline-block px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors"
                >
                  Start Shopping
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div key={order.id} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
                    {/* Order Header */}
                    <div className="bg-surface border-b border-border-default px-4 sm:px-6 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-6">
                          <div>
                            <p className="text-xs text-foreground-muted mb-1">Order Number</p>
                            <p className="font-mono text-sm font-medium text-foreground">
                              {order.order_number}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-foreground-muted mb-1">Order Date</p>
                            <p className="text-sm text-foreground">
                              {new Date(order.created_at).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-foreground-muted mb-1">Total</p>
                            <p className="text-sm font-semibold text-foreground">
                              ₹{order.total_amount.toLocaleString('en-IN')}
                            </p>
                          </div>
                        </div>
                        <div>
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(
                              order.status
                            )}`}
                          >
                            {order.status === 'cancel_requested' ? 'Cancellation Requested' : order.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Order Items */}
                    <div className="p-4 sm:p-6">
                      <div className="space-y-4">
                        {order.order_items.map((item) => {
                          const primaryImage = item.products?.product_images?.find(img => img.is_primary) || item.products?.product_images?.[0]

                          return (
                            <div key={item.id} className="flex gap-4">
                              <div className="relative w-20 h-20 flex-shrink-0 bg-surface-elevated rounded-lg overflow-hidden border border-border-default">
                                {primaryImage ? (
                                  <img
                                    src={primaryImage.thumbnail_url}
                                    alt={item.product_name}
                                    className="w-full h-full object-cover rounded-lg"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <Link
                                  href={`/products/${item.products?.slug}`}
                                  className="font-medium text-foreground hover:text-accent-600 dark:hover:text-accent-400 mb-1 block"
                                >
                                  {item.product_name}
                                </Link>
                                <p className="text-sm text-foreground-secondary">Quantity: {item.quantity}</p>
                                <p className="text-sm font-semibold text-foreground mt-1">
                                  ₹{item.unit_price.toLocaleString('en-IN')} × {item.quantity} = ₹{item.total_price.toLocaleString('en-IN')}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Shipping Address */}
                      {order.addresses && (
                        <div className="mt-6 pt-6 border-t border-border-default">
                          <h4 className="text-sm font-semibold text-foreground mb-2">Shipping Address</h4>
                          <div className="text-sm text-foreground-secondary">
                            <p>{order.addresses.address_line1}</p>
                            {order.addresses.address_line2 && <p>{order.addresses.address_line2}</p>}
                            <p>
                              {order.addresses.city}, {order.addresses.state} {order.addresses.postal_code}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* View Details */}
                      <div className="mt-4 pt-4 border-t border-border-default flex items-center justify-between">
                        <Link
                          href={`/account/orders/${order.id}`}
                          className="inline-flex items-center text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 font-medium text-sm"
                        >
                          View Order Details
                          <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                        {(order.status === 'pending' || order.status === 'confirmed') && (
                          confirmCancelId === order.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-red-700 dark:text-red-400">Request cancellation?</span>
                              <button
                                type="button"
                                onClick={() => handleCancelOrder(order.id)}
                                disabled={cancellingOrderId === order.id}
                                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium transition-colors disabled:bg-red-300 disabled:cursor-not-allowed flex items-center"
                              >
                                {cancellingOrderId === order.id ? (
                                  <>
                                    <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full mr-1"></div>
                                    Submitting
                                  </>
                                ) : 'Yes'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmCancelId(null)}
                                className="px-3 py-1 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded text-xs font-medium transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmCancelId(order.id)}
                              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium"
                            >
                              Request Cancellation
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


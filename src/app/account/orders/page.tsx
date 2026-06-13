'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'
import { useAccountSearch } from '@/contexts/AccountSearchContext'

interface OrderItem {
  id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  buy_mode?: string
  buy_unit?: string | null
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

function getStatusColor(status: string) {
  switch (status) {
    case 'pending':        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'confirmed':      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'shipped':        return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
    case 'out_for_delivery': return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
    case 'delivered':      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'cancel_requested': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'cancelled':      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'return_requested': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'return_approved':
    case 'return_received':  return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'return_rejected':  return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'returned':       return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
    default:               return 'bg-surface-secondary text-foreground'
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'cancel_requested':  return 'Cancellation Requested'
    case 'cancel_rejected':   return 'Cancellation Rejected'
    case 'out_for_delivery':  return 'Out for Delivery'
    case 'return_requested':  return 'Return Requested'
    case 'return_approved':   return 'Return Approved'
    case 'return_received':   return 'Return Received'
    case 'return_rejected':   return 'Return Rejected'
    default: return status.charAt(0).toUpperCase() + status.slice(1)
  }
}

export default function OrdersPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { query: searchQuery, register } = useAccountSearch()
  const confirm = useConfirm()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  const suggestions = useMemo(() => {
    const set = new Set<string>()
    orders.forEach(o => {
      set.add(o.order_number)
      set.add(getStatusLabel(o.status))
      o.order_items.forEach(i => set.add(i.product_name))
    })
    return Array.from(set)
  }, [orders])

  useEffect(() => {
    register({ suggestions, placeholder: 'Search orders…' })
  }, [suggestions, register])

  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders
    const q = searchQuery.toLowerCase()
    return orders.filter(o =>
      o.order_number.toLowerCase().includes(q) ||
      getStatusLabel(o.status).toLowerCase().includes(q) ||
      o.order_items.some(i => i.product_name.toLowerCase().includes(q))
    )
  }, [orders, searchQuery])

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login?redirect=/account/orders')
    }
    if (user) {
      fetchOrders(page)
    }
  }, [user, isLoading, router, page])

  const fetchOrders = async (p: number) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/orders?page=${p}`)
      if (response.ok) {
        const data = await response.json()
        setOrders(data.orders || [])
        setTotal(data.total || 0)
        setPageSize(data.pageSize || 10)
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  const handleCancelOrder = async (orderId: string) => {
    const ok = await confirm({
      title: 'Request cancellation?',
      message: 'Request cancellation for this order? This action cannot be undone.',
      confirmLabel: 'Request Cancellation',
      cancelLabel: 'Keep Order',
      variant: 'danger',
    })
    if (!ok) return
    setCancellingOrderId(orderId)
    try {
      await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' })
      await fetchOrders(page)
    } catch {
    } finally {
      setCancellingOrderId(null)
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
      <AccountMobileHeader />

      <div className="container mx-auto px-4 pt-4">
        <div>
            {filteredOrders.length === 0 ? (
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
                {filteredOrders.map((order) => {
                  const firstItem = order.order_items[0]
                  const firstItemImage = firstItem?.products?.product_images?.find(img => img.is_primary) || firstItem?.products?.product_images?.[0]
                  const extraItems = order.order_items.length - 1
                  const orderDate = new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

                  return (
                  <div key={order.id} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">

                    {/* Mobile card — compact header + first item only */}
                    <div className="sm:hidden">
                      <div className="bg-surface border-b border-border-default px-4 py-3">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <Link
                            href={`/account/orders/${order.id}`}
                            className="font-mono text-sm font-semibold text-foreground hover:text-accent-500 hover:underline transition-colors truncate"
                          >
                            {order.order_number}
                          </Link>
                          <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                            {getStatusLabel(order.status)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-foreground-secondary">
                          <span>{orderDate}</span>
                          <span className="w-px h-3 bg-border-default" />
                          <span className="font-semibold text-foreground">₹{order.total_amount.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                      <div className="px-4 py-3">
                        {firstItem && (
                          <div className="flex gap-3 items-center">
                            <div className="w-12 h-12 flex-shrink-0 bg-surface rounded-lg overflow-hidden border border-border-default">
                              {firstItemImage ? (
                                <img src={firstItemImage.thumbnail_url} alt={firstItem.product_name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{firstItem.product_name}</p>
                              <p className="text-xs text-foreground-secondary mt-0.5">
                                Qty: {firstItem.buy_mode === 'weight' || firstItem.buy_mode === 'length' ? `${Number(firstItem.quantity).toFixed(3)} ${firstItem.buy_unit ?? ''}` : Math.round(Number(firstItem.quantity))}
                                {extraItems > 0 && <span className="ml-1.5 text-foreground-muted">+{extraItems} more item{extraItems > 1 ? 's' : ''}</span>}
                              </p>
                            </div>
                          </div>
                        )}
                        <div className="mt-3 pt-3 border-t border-border-default flex items-center justify-between gap-2">
                          <Link
                            href={`/account/orders/${order.id}`}
                            className="inline-flex items-center text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 font-medium text-sm"
                          >
                            View Details
                            <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                          {(order.status === 'pending' || order.status === 'confirmed') && (
                            <button type="button" onClick={() => handleCancelOrder(order.id)} disabled={cancellingOrderId === order.id} className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium disabled:opacity-50">
                              {cancellingOrderId === order.id ? 'Submitting…' : 'Request Cancellation'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Desktop card — full layout */}
                    <div className="hidden sm:block">
                      <div className="bg-surface border-b border-border-default px-6 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div className="flex flex-wrap items-center gap-6">
                            <div>
                              <p className="text-xs text-foreground-muted mb-1">Order Number</p>
                              <Link
                                href={`/account/orders/${order.id}`}
                                className="font-mono text-sm font-medium text-foreground hover:text-accent-500 hover:underline transition-colors"
                              >
                                {order.order_number}
                              </Link>
                            </div>
                            <div>
                              <p className="text-xs text-foreground-muted mb-1">Order Date</p>
                              <p className="text-sm text-foreground">{orderDate}</p>
                            </div>
                            <div>
                              <p className="text-xs text-foreground-muted mb-1">Total</p>
                              <p className="text-sm font-semibold text-foreground">₹{order.total_amount.toLocaleString('en-IN')}</p>
                            </div>
                          </div>
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                            {getStatusLabel(order.status)}
                          </span>
                        </div>
                      </div>
                      <div className="p-6">
                        <div className="space-y-4">
                          {order.order_items.map((item) => {
                            const primaryImage = item.products?.product_images?.find(img => img.is_primary) || item.products?.product_images?.[0]
                            return (
                              <div key={item.id} className="flex gap-4">
                                <div className="relative w-20 h-20 flex-shrink-0 bg-surface-elevated rounded-lg overflow-hidden border border-border-default">
                                  {primaryImage ? (
                                    <img src={primaryImage.thumbnail_url} alt={item.product_name} className="w-full h-full object-cover rounded-lg" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <Link href={`/products/${item.products?.slug}`} className="font-medium text-foreground hover:text-accent-600 dark:hover:text-accent-400 mb-1 block">
                                    {item.product_name}
                                  </Link>
                                  <p className="text-sm text-foreground-secondary">Quantity: {item.buy_mode === 'weight' || item.buy_mode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}` : Math.round(Number(item.quantity))}</p>
                                  <p className="text-sm font-semibold text-foreground mt-1">
                                    ₹{item.unit_price.toLocaleString('en-IN')} × {item.buy_mode === 'weight' || item.buy_mode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}` : Math.round(Number(item.quantity))} = ₹{item.total_price.toLocaleString('en-IN')}
                                  </p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        {order.addresses && (
                          <div className="mt-6 pt-6 border-t border-border-default">
                            <h4 className="text-sm font-semibold text-foreground mb-2">Shipping Address</h4>
                            <div className="text-sm text-foreground-secondary">
                              <p>{order.addresses.address_line1}</p>
                              {order.addresses.address_line2 && <p>{order.addresses.address_line2}</p>}
                              <p>{order.addresses.city}, {order.addresses.state} {order.addresses.postal_code}</p>
                            </div>
                          </div>
                        )}
                        <div className="mt-4 pt-4 border-t border-border-default flex items-center justify-between">
                          <Link href={`/account/orders/${order.id}`} className="inline-flex items-center text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 font-medium text-sm">
                            View Order Details
                            <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                          {(order.status === 'pending' || order.status === 'confirmed') && (
                            <button type="button" onClick={() => handleCancelOrder(order.id)} disabled={cancellingOrderId === order.id} className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium disabled:opacity-50">
                              {cancellingOrderId === order.id ? 'Submitting…' : 'Request Cancellation'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                  )
                })}

                {total > pageSize && (
                  <div className="flex items-center justify-between gap-2 pt-4">
                    <p className="text-xs text-foreground-muted whitespace-nowrap">
                      <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</span>
                      {' '}of <span className="font-medium text-foreground">{total}</span> orders
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
                      >
                        Prev
                      </button>
                      <span className="text-xs text-foreground-muted whitespace-nowrap">{page}/{Math.ceil(total / pageSize)}</span>
                      <button
                        onClick={() => setPage(p => p + 1)}
                        disabled={page >= Math.ceil(total / pageSize)}
                        className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
      </div>
    </div>
  )
}


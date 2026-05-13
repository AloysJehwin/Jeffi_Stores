'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AccountSidebar, { navItems } from '@/components/visitor/AccountSidebar'

interface DashboardData {
  stats: { total_orders: number; total_spent: number; active_orders: number }
  recentOrders: Array<{
    id: string
    order_number: string
    created_at: string
    status: string
    total_amount: number
    items: Array<{ product_name: string; quantity: number; thumbnail_url: string | null }>
  }>
  defaultAddress: {
    full_name: string
    address_line1: string
    address_line2?: string
    landmark?: string
    city: string
    state: string
    postal_code: string
    phone: string
  } | null
  wishlistCount: number
}

const statusColor: Record<string, string> = {
  pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
  confirmed: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  shipped: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
  out_for_delivery: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300',
  delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
  cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
  cancel_requested: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
  return_requested: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
  returned: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
}

const statusLabel: Record<string, string> = {
  cancel_requested: 'Cancel Requested',
  out_for_delivery: 'Out for Delivery',
  return_requested: 'Return Requested',
  return_approved: 'Return Approved',
  return_received: 'Return Received',
  return_rejected: 'Return Rejected',
}

function getStatusLabel(s: string) {
  return statusLabel[s] ?? (s.charAt(0).toUpperCase() + s.slice(1))
}

function getStatusColor(s: string) {
  return statusColor[s] ?? 'bg-surface-secondary text-foreground'
}

export default function AccountPage() {
  const { user, isLoading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({ firstName: '', lastName: '', phone: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login?redirect=/account')
    }
    if (user) {
      setFormData({
        firstName: user.firstName,
        lastName: user.lastName || '',
        phone: (user.phone || '').replace(/^\+91/, ''),
      })
      fetch('/api/user/dashboard')
        .then(r => r.json())
        .then(setDashboard)
        .catch(() => {})
    }
  }, [user, isLoading, router])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.phone && formData.phone.length !== 10) {
      setMessage('Enter a valid 10-digit mobile number')
      return
    }
    setIsSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/user/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (!response.ok) throw new Error()
      setMessage('Profile updated successfully!')
      setIsEditing(false)
      window.location.reload()
    } catch {
      setMessage('Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-foreground-secondary">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  const quickActions = [
    { label: 'My Orders', href: '/account/orders', icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
    )},
    { label: 'Transactions', href: '/account/transactions', icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>
    )},
    { label: 'Addresses', href: '/account/addresses', icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    )},
    { label: 'Wishlist', href: '/wishlist', icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
    )},
    { label: 'Browse Products', href: '/products', icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
    )},
    { label: 'Sign Out', href: null, onClick: logout, icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
    )},
  ]

  return (
    <div className="bg-surface min-h-screen lg:h-[calc(100vh-5rem)] lg:overflow-hidden">

      {/* Mobile header */}
      <div className="lg:hidden bg-accent-500 pt-8 pb-16 px-4 relative">
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

      <div className="container mx-auto px-4 h-full">
        <div className="hidden lg:block py-8">
          <h1 className="text-3xl font-bold text-foreground">My Account</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 lg:h-[calc(100%-5rem)]">
          <div className="hidden lg:block lg:col-span-1 lg:h-full lg:overflow-y-auto pt-8 pb-8">
            <AccountSidebar />
          </div>

          <div className="lg:col-span-3 lg:h-full lg:overflow-y-auto py-4 sm:py-6 lg:pt-8 lg:pb-8 space-y-5">

            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{dashboard?.stats.total_orders ?? '—'}</p>
                <p className="text-xs text-foreground-muted mt-1">Total Orders</p>
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 text-center">
                <p className="text-2xl font-bold text-foreground">
                  {dashboard ? `₹${Number(dashboard.stats.total_spent).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                <p className="text-xs text-foreground-muted mt-1">Total Spent</p>
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 text-center">
                <p className="text-2xl font-bold text-accent-600 dark:text-accent-400">{dashboard?.stats.active_orders ?? '—'}</p>
                <p className="text-xs text-foreground-muted mt-1">Active Orders</p>
              </div>
            </div>

            {/* Profile + Default Address row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Profile card */}
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-foreground">Profile</h2>
                  {!isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium px-2.5 py-1 rounded-lg border border-accent-200 dark:border-accent-800 transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {message && (
                  <div className={`mb-3 p-2.5 rounded-lg text-xs ${message.includes('success') ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                    {message}
                  </div>
                )}

                {!isEditing ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent-100 dark:bg-accent-900/40 flex items-center justify-center text-lg font-bold text-accent-600 dark:text-accent-400 flex-shrink-0">
                        {user.firstName?.[0]?.toUpperCase() || 'U'}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm">{user.firstName} {user.lastName}</p>
                        <p className="text-xs text-foreground-muted truncate">{user.email}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-border-default space-y-2">
                      <div className="flex justify-between">
                        <span className="text-xs text-foreground-muted">Phone</span>
                        <span className="text-xs font-medium text-foreground">
                          {user.phone ? (user.phone.startsWith('+91') ? user.phone : `+91 ${user.phone}`) : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-foreground-muted">Member since</span>
                        <span className="text-xs font-medium text-foreground">
                          {new Date(user.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSave} className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-foreground-secondary mb-1">First Name *</label>
                        <input
                          type="text"
                          required
                          value={formData.firstName}
                          onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                          className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground-secondary mb-1">Last Name</label>
                        <input
                          type="text"
                          value={formData.lastName}
                          onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                          className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Phone</label>
                      <div className="flex">
                        <span className="inline-flex items-center px-2.5 py-2 border border-r-0 border-border-secondary rounded-l-lg bg-surface text-foreground-secondary text-xs font-medium">+91</span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          value={formData.phone}
                          onChange={e => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                          className="w-full px-3 py-2 border border-border-secondary rounded-r-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                          placeholder="98765 43210"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="submit" disabled={isSaving} className="flex-1 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-xs transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center justify-center">
                        {isSaving ? <><div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full mr-1.5"></div>Saving...</> : 'Save'}
                      </button>
                      <button type="button" disabled={isSaving} onClick={() => { setIsEditing(false); setFormData({ firstName: user.firstName, lastName: user.lastName || '', phone: (user.phone || '').replace(/^\+91/, '') }) }} className="flex-1 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-semibold text-xs transition-colors disabled:opacity-50">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Default address */}
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-foreground">Default Address</h2>
                  <Link href="/account/addresses" className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium px-2.5 py-1 rounded-lg border border-accent-200 dark:border-accent-800 transition-colors">
                    Manage
                  </Link>
                </div>
                {dashboard?.defaultAddress ? (
                  <div className="space-y-1 text-sm text-foreground-secondary">
                    <p className="font-semibold text-foreground text-sm">{dashboard.defaultAddress.full_name}</p>
                    <p className="text-xs">{dashboard.defaultAddress.address_line1}</p>
                    {dashboard.defaultAddress.address_line2 && <p className="text-xs">{dashboard.defaultAddress.address_line2}</p>}
                    {dashboard.defaultAddress.landmark && <p className="text-xs text-foreground-muted">Near {dashboard.defaultAddress.landmark}</p>}
                    <p className="text-xs">{dashboard.defaultAddress.city}, {dashboard.defaultAddress.state} — {dashboard.defaultAddress.postal_code}</p>
                    <p className="text-xs text-foreground-muted pt-1">{dashboard.defaultAddress.phone}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-24 text-center">
                    <p className="text-xs text-foreground-muted mb-2">No default address saved</p>
                    <Link href="/account/addresses" className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium underline underline-offset-2">
                      Add an address
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Orders */}
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-foreground">Recent Orders</h2>
                <Link href="/account/orders" className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium">
                  View all
                </Link>
              </div>
              {dashboard?.recentOrders.length === 0 || !dashboard ? (
                <div className="text-center py-6">
                  <p className="text-sm text-foreground-muted mb-3">No orders yet</p>
                  <Link href="/products" className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium underline underline-offset-2">
                    Start shopping
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {dashboard.recentOrders.map(order => (
                    <Link key={order.id} href={`/account/orders/${order.id}`} className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface transition-colors group">
                      {/* Thumbnails */}
                      <div className="flex -space-x-2 flex-shrink-0">
                        {order.items.slice(0, 3).map((item, i) => (
                          <div key={i} className="w-10 h-10 rounded-lg border-2 border-surface-elevated overflow-hidden bg-surface flex items-center justify-center flex-shrink-0">
                            {item.thumbnail_url ? (
                              <img src={item.thumbnail_url} alt="" aria-hidden className="w-full h-full object-cover" />
                            ) : (
                              <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-foreground-muted">#{order.order_number}</p>
                        <p className="text-sm font-medium text-foreground truncate">
                          {order.items[0]?.product_name}
                          {order.items.length > 1 && <span className="text-foreground-muted"> +{order.items.length - 1} more</span>}
                        </p>
                        <p className="text-xs text-foreground-muted">
                          {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      {/* Right */}
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-sm font-semibold text-foreground">₹{Number(order.total_amount).toLocaleString('en-IN')}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getStatusColor(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Quick Actions</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {quickActions.map(action => (
                  action.href ? (
                    <Link
                      key={action.label}
                      href={action.href}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-surface transition-colors group text-center"
                    >
                      <span className="text-foreground-secondary group-hover:text-accent-500 transition-colors">{action.icon}</span>
                      <span className="text-[11px] font-medium text-foreground-secondary leading-tight">{action.label}</span>
                    </Link>
                  ) : (
                    <button
                      key={action.label}
                      onClick={action.onClick}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group text-center"
                    >
                      <span className="text-foreground-secondary group-hover:text-red-500 transition-colors">{action.icon}</span>
                      <span className="text-[11px] font-medium text-foreground-secondary leading-tight">{action.label}</span>
                    </button>
                  )
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

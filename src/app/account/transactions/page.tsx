'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AccountSidebar, { navItems } from '@/components/visitor/AccountSidebar'

interface Transaction {
  id: string
  transactionId: string
  paymentMethod: string
  paymentGateway: string
  amount: number
  status: string
  createdAt: string
  updatedAt: string
  orderId: string
  orderNumber: string
}

function getStatusColor(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'pending':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'failed':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'refunded':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
    default:
      return 'bg-surface-secondary text-foreground'
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'pending':
      return 'Pending'
    case 'failed':
      return 'Failed'
    case 'refunded':
      return 'Refunded'
    default:
      return status
  }
}

function getMethodLabel(method: string, gateway: string) {
  if (gateway === 'razorpay') return 'Razorpay'
  if (method === 'cod') return 'Cash on Delivery'
  if (method === 'bank_transfer') return 'Bank Transfer'
  if (method === 'upi') return 'UPI'
  return method ? method.charAt(0).toUpperCase() + method.slice(1) : 'N/A'
}

export default function TransactionsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/account/transactions')
      return
    }
    if (user) {
      fetchTransactions(page)
    }
  }, [user, authLoading, router, page])

  const fetchTransactions = async (p: number) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/transactions?page=${p}`)
      if (response.ok) {
        const data = await response.json()
        setTransactions(data.transactions || [])
        setTotal(data.total || 0)
        setPageSize(data.pageSize || 10)
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || loading) {
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
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Transactions</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="hidden lg:block lg:col-span-1 lg:self-start lg:sticky lg:top-24">
            <AccountSidebar />
          </div>

          <div className="lg:col-span-3">
            {transactions.length === 0 ? (
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
                    d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
                  />
                </svg>
                <h3 className="text-xl font-semibold text-foreground mb-2">No transactions yet</h3>
                <p className="text-foreground-secondary mb-6">
                  Your payment transactions will appear here once you place an order.
                </p>
                <Link
                  href="/products"
                  className="inline-block px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors"
                >
                  Browse Products
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {transactions.map((txn) => (
                  <div
                    key={txn.id}
                    className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      {/* Left side */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(txn.status)}`}>
                            {getStatusLabel(txn.status)}
                          </span>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-secondary">
                            {getMethodLabel(txn.paymentMethod, txn.paymentGateway)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                          <span className="text-lg font-bold text-foreground">
                            {txn.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                          </span>
                          <Link
                            href={`/account/orders/${txn.orderId}`}
                            className="text-sm text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 font-medium"
                          >
                            Order #{txn.orderNumber}
                          </Link>
                        </div>

                        {txn.transactionId && (
                          <p className="text-xs text-foreground-muted mt-1 font-mono truncate">
                            TXN: {txn.transactionId}
                          </p>
                        )}
                      </div>

                      {/* Right side */}
                      <div className="text-sm text-foreground-muted sm:text-right flex-shrink-0">
                        <p>
                          {new Date(txn.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                        <p className="text-xs">
                          {new Date(txn.createdAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Kolkata',
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {total > pageSize && (
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-sm text-foreground-muted">
                      Showing <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</span> of{' '}
                      <span className="font-medium text-foreground">{total}</span> transactions
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="px-3 py-1.5 text-sm font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-foreground-muted">Page {page} of {Math.ceil(total / pageSize)}</span>
                      <button
                        onClick={() => setPage(p => p + 1)}
                        disabled={page >= Math.ceil(total / pageSize)}
                        className="px-3 py-1.5 text-sm font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
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
    </div>
  )
}

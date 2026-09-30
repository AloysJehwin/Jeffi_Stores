'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { bp } from '@/lib/business-path'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'
import BusinessAccountMobileHeader from '@/components/business/AccountMobileHeader'

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

function AccountTransactions({ isBusiness }: { isBusiness: boolean }) {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterMethod, setFilterMethod] = useState<string>('all')

  const portalHeader: Record<string, string> = isBusiness ? { 'X-Auth-Portal': 'business' } : {}
  const portalFetch: RequestInit = isBusiness ? { credentials: 'include' } : {}
  const browsePath = isBusiness ? bp('/business/products') : '/products'
  const orderPath = (orderId: string) =>
    isBusiness ? bp(`/business/account/orders/${orderId}`) : `/account/orders/${orderId}`

  const availableMethods = useMemo(() => {
    const set = new Set<string>()
    transactions.forEach(t => set.add(getMethodLabel(t.paymentMethod, t.paymentGateway)))
    return Array.from(set)
  }, [transactions])

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false
      if (filterMethod !== 'all' && getMethodLabel(t.paymentMethod, t.paymentGateway) !== filterMethod) return false
      return true
    })
  }, [transactions, filterStatus, filterMethod])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push(
        isBusiness
          ? bp('/business/signin?callbackUrl=/business/account/transactions')
          : '/login?redirect=/account/transactions'
      )
      return
    }
    if (user) {
      fetchTransactions(page)
    }
  }, [user, authLoading, router, page])

  const fetchTransactions = async (p: number) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/transactions?page=${p}`, {
        ...portalFetch,
        headers: { ...portalHeader },
      })
      if (response.ok) {
        const data = await response.json()
        setTransactions(data.transactions || [])
        setTotal(data.total || 0)
        setPageSize(data.pageSize || 10)
      }
    } catch {
    } finally {
      setLoading(false)
      setInitialLoading(false)
    }
  }

  if (authLoading || initialLoading) {
    return (
      <div className="container mx-auto px-4 pt-4 pb-8">
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-elevated rounded-lg border border-border-default p-4"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="h-3 bg-surface-secondary rounded w-32" />
                <div className="h-5 bg-surface-secondary rounded-full w-16" />
              </div>
              <div className="flex items-center justify-between">
                <div className="h-4 bg-surface-secondary rounded w-24" />
                <div className="h-4 bg-surface-secondary rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="bg-surface min-h-screen">
      {/* Mobile header */}
      {isBusiness ? <BusinessAccountMobileHeader /> : <AccountMobileHeader />}

      <div className="container mx-auto px-4 pt-4 pb-8">
        {/* Filters */}
        {transactions.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(['all', 'completed', 'pending', 'failed', 'refunded'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filterStatus === s
                      ? 'bg-accent-500 text-white'
                      : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
                  }`}
                >
                  {s === 'all' ? 'All' : getStatusLabel(s)}
                </button>
              ))}
            </div>
            {availableMethods.length > 1 && (
              <select
                value={filterMethod}
                onChange={e => setFilterMethod(e.target.value)}
                className="text-xs px-3 py-1 rounded-full border border-border-default bg-surface-elevated text-foreground-secondary focus:outline-none focus:ring-1 focus:ring-accent-500"
              >
                <option value="all">All Methods</option>
                {availableMethods.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div>
          {transactions.length === 0 && !loading ? (
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
                href={browsePath}
                className="inline-block px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors"
              >
                Browse Products
              </Link>
            </div>
          ) : loading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-5 animate-pulse"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex gap-2">
                        <div className="h-5 w-20 bg-surface-secondary rounded-full" />
                        <div className="h-5 w-24 bg-surface-secondary rounded-full" />
                      </div>
                      <div className="h-5 w-32 bg-surface-secondary rounded" />
                      <div className="h-3 w-48 bg-surface-secondary rounded" />
                    </div>
                    <div className="space-y-1.5 sm:text-right flex-shrink-0">
                      <div className="h-4 w-24 bg-surface-secondary rounded" />
                      <div className="h-3 w-16 bg-surface-secondary rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTransactions.map(txn => (
                <div
                  key={txn.id}
                  className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Left side */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(txn.status)}`}
                        >
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
                          href={orderPath(txn.orderId)}
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
                <div className="flex items-center justify-between gap-2 pt-2">
                  <p className="text-xs text-foreground-muted whitespace-nowrap">
                    <span className="font-medium text-foreground">
                      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}
                    </span>{' '}
                    of <span className="font-medium text-foreground">{total}</span> transactions
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      Prev
                    </button>
                    <span className="text-xs text-foreground-muted whitespace-nowrap">
                      {page}/{Math.ceil(total / pageSize)}
                    </span>
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

export function AccountTransactionsVisitor() {
  return <AccountTransactions isBusiness={false} />
}

export function AccountTransactionsBusiness() {
  return <AccountTransactions isBusiness={true} />
}

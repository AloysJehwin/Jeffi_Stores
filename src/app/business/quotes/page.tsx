'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { BusinessAccountNavBar } from '@/components/business/AccountSidebar'
import BusinessAccountMobileHeader from '@/components/business/AccountMobileHeader'
import { bp } from '@/lib/business-path'

interface RFQ {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  item_count: number
  converted_quotation_id: string | null
  quote_number: string | null
  quotation_view_token: string | null
  quotation_total: string | null
  requested_total: string | null
  created_at: string
  order_id: string | null
  invoice_view_token: string | null
  invoice_number: string | null
  payment_status: string | null
  order_status: string | null
  invoice_total: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  reviewed:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  negotiating: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  converted:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

export default function MyQuotesPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 20

  const filteredRfqs = useMemo(() =>
    filterStatus === 'all' ? rfqs : rfqs.filter(r => r.status === filterStatus),
    [rfqs, filterStatus]
  )

  const totalPages = Math.ceil(total / PAGE_SIZE)

  useEffect(() => {
    if (!isLoading && (!user || !user.isBusiness || user.approvalStatus !== 'approved')) {
      router.push(bp('/business/account'))
    }
  }, [user, isLoading])

  useEffect(() => {
    if (!user?.isBusiness) return
    setLoading(true)
    fetch(`/api/business/rfqs?page=${page}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setRfqs(d.rfqs || []); setTotal(d.total || 0); setLoading(false) })
      .catch(() => setLoading(false))
  }, [user, page])

  if (isLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface min-h-screen">
      <BusinessAccountNavBar />
      <BusinessAccountMobileHeader />
      <div className="container mx-auto px-4 pt-4 pb-8">

        {/* Status filter */}
        {rfqs.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            {(['all', 'pending', 'reviewed', 'negotiating', 'converted', 'rejected'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                  filterStatus === s
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
                }`}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        )}

        <div>
          {rfqs.length === 0 ? (
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-foreground-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              <p className="text-foreground-secondary font-medium">No quote requests yet</p>
              <p className="text-sm text-foreground-muted mt-1">Use the &ldquo;Request Quote&rdquo; button on any product page or cart to get started.</p>
              <Link href={bp('/business/products')} className="mt-4 inline-block text-sm font-medium text-accent-600 dark:text-accent-400 hover:text-accent-700">
                Browse Products
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {filterStatus !== 'all' && filteredRfqs.length === 0 && (
                <p className="text-sm text-foreground-secondary text-center py-8">No quotes with this status on this page.</p>
              )}
              {filteredRfqs.map(rfq => {
                const displayTotal = rfq.quotation_total
                  ? Number(rfq.quotation_total)
                  : rfq.requested_total
                    ? Number(rfq.requested_total)
                    : null

                const statusMsg: Record<string, string> = {
                  pending: 'Awaiting review by our team',
                  reviewed: 'Under review — quotation being prepared',
                  negotiating: 'Negotiating — check messages for updates',
                  converted: 'Quotation issued',
                  rejected: 'Not accepted — contact support for details',
                }

                return (
                  <div key={rfq.id} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-5">
                    {/* Top row: RFQ number + status + amount */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <Link
                          href={bp(`/business/quotes/${rfq.id}`)}
                          className="font-semibold text-foreground hover:text-accent-500 hover:underline transition-colors font-mono text-sm break-all"
                        >
                          {rfq.rfq_number}
                        </Link>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[rfq.status] || STATUS_STYLES.pending}`}>
                            {rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)}
                          </span>
                          {rfq.order_id && rfq.payment_status && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                              rfq.payment_status === 'paid'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : rfq.payment_status === 'partial'
                                  ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}>
                              {rfq.payment_status === 'paid' ? 'Paid' : rfq.payment_status === 'partial' ? 'Partially paid' : 'Unpaid'}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Amount — top-right */}
                      {rfq.order_id && rfq.invoice_total ? (
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-foreground-muted leading-none mb-0.5">Invoice total</p>
                          <p className="text-base font-bold text-foreground">
                            ₹{Number(rfq.invoice_total).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </p>
                        </div>
                      ) : displayTotal !== null && displayTotal > 0 ? (
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-foreground-muted leading-none mb-0.5">
                            {rfq.quotation_total ? 'Quoted value' : 'Requested value'}
                          </p>
                          <p className="text-base font-bold text-foreground">
                            ₹{displayTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    {/* Meta */}
                    <p className="text-sm text-foreground-secondary mb-1">
                      {rfq.item_count} item{rfq.item_count !== 1 ? 's' : ''}
                      {' · '}
                      {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    {rfq.notes && (
                      <p className="text-xs text-foreground-muted mb-1 line-clamp-1">{rfq.notes}</p>
                    )}
                    <p className="text-xs text-foreground-muted italic mb-3">
                      {statusMsg[rfq.status] ?? ''}
                    </p>

                    {/* Action buttons — full width on mobile */}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Link
                        href={bp(`/business/quotes/${rfq.id}`)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-xs font-medium transition-colors"
                      >
                        View Details →
                      </Link>
                      {rfq.status === 'converted' && rfq.quotation_view_token && (
                        <a
                          href={`https://quotation.jeffistores.in/${rfq.quotation_view_token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-xs font-medium transition-colors"
                        >
                          View Quotation
                          {rfq.quote_number && <span className="opacity-70 truncate max-w-[120px]">({rfq.quote_number})</span>}
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                      {rfq.order_id && rfq.invoice_view_token && rfq.order_status !== 'draft' && (
                        <a
                          href={`https://invoice.jeffistores.in/${rfq.invoice_view_token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold transition-colors"
                        >
                          View Invoice
                          {rfq.invoice_number && <span className="opacity-80 truncate max-w-[120px]">({rfq.invoice_number})</span>}
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                      {!rfq.order_id && (
                        rfq.status === 'pending' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400 text-xs font-medium bg-yellow-50 dark:bg-yellow-900/20 self-start">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Pending review
                          </span>
                        ) : rfq.status === 'reviewed' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 text-xs font-medium bg-blue-50 dark:bg-blue-900/20 self-start">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            In progress
                          </span>
                        ) : rfq.status === 'rejected' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium bg-red-50 dark:bg-red-900/20 self-start">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            Not accepted
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border-default">
              <p className="text-sm text-foreground-secondary">
                Page {page} of {totalPages} · {total} total
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

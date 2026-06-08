'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { BusinessAccountNavBar } from '@/components/business/AccountSidebar'
import BusinessAccountMobileHeader from '@/components/business/AccountMobileHeader'

interface RFQ {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  item_count: number
  converted_quotation_id: string | null
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  reviewed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  converted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

export default function MyQuotesPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const filteredRfqs = useMemo(() =>
    filterStatus === 'all' ? rfqs : rfqs.filter(r => r.status === filterStatus),
    [rfqs, filterStatus]
  )

  useEffect(() => {
    if (!isLoading && (!user || !user.isBusiness || user.approvalStatus !== 'approved')) {
      router.push('/business/account')
    }
  }, [user, isLoading])

  useEffect(() => {
    if (!user?.isBusiness) return
    fetch('/api/business/rfqs', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setRfqs(d.rfqs || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [user])

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
      <div className="hidden lg:block"><BusinessAccountNavBar /></div>
      <BusinessAccountMobileHeader />
      <div className="container mx-auto px-4 pt-4 pb-8">

        {/* Status filter */}
        {rfqs.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            {(['all', 'pending', 'reviewed', 'converted', 'rejected'] as const).map(s => (
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

        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
          <div className="px-6 py-4 border-b border-border-default">
            <p className="text-sm text-foreground-secondary">Track your RFQ submissions. Our team will review and respond.</p>
          </div>

          {rfqs.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-foreground-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              <p className="text-foreground-secondary font-medium">No quote requests yet</p>
              <p className="text-sm text-foreground-muted mt-1">Use the &ldquo;Request Quote&rdquo; button on any product page or cart to get started.</p>
              <Link href="/business/products" className="mt-4 inline-block text-sm font-medium text-accent-600 dark:text-accent-400 hover:text-accent-700">
                Browse Products
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border-default">
              {filteredRfqs.map(rfq => (
                <div key={rfq.id} className="p-5 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-foreground font-mono text-sm">{rfq.rfq_number}</span>
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[rfq.status] || STATUS_STYLES.pending}`}>
                        {rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground-secondary">{rfq.item_count} item{rfq.item_count !== 1 ? 's' : ''}</p>
                    {rfq.notes && <p className="text-sm text-foreground-muted mt-1 line-clamp-1">{rfq.notes}</p>}
                    <p className="text-xs text-foreground-muted mt-1">
                      Submitted {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  {rfq.status === 'converted' && rfq.converted_quotation_id && (
                    <span className="text-xs text-green-700 dark:text-green-400 font-medium shrink-0">
                      Quotation sent — check your email
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

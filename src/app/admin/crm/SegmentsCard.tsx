'use client'

import { useState } from 'react'
import Link from 'next/link'
import CrmCampaignPanel from './CrmCampaignPanel'

interface SegmentMeta {
  key: string
  label: string
  count: number
  color: string
  defaultCampaign: string
}

interface Customer {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  lifetime_value: number
  order_count: number
  last_order_at: string | null
  health_score: number | null
}

function fmtName(c: Customer) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function CustomerRow({ c, large }: { c: Customer; large?: boolean }) {
  return (
    <Link
      href={`/admin/customers/${c.id}`}
      className={`flex items-center justify-between gap-3 ${large ? 'py-2.5' : 'py-2'} hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{fmtName(c)}</p>
        <p className="text-[11px] text-foreground-muted">
          {c.email}
          {c.lifetime_value > 0 && ` · ₹${Math.round(c.lifetime_value).toLocaleString('en-IN')} LTV`}
          {c.order_count > 0 && ` · ${c.order_count} order${c.order_count !== 1 ? 's' : ''}`}
          {c.last_order_at && ` · Last ${fmtDate(c.last_order_at)}`}
        </p>
      </div>
      {c.health_score != null && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
          c.health_score >= 60 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
          : c.health_score >= 40 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
        }`}>{c.health_score}</span>
      )}
    </Link>
  )
}

interface ModalProps {
  segment: SegmentMeta
  onClose: () => void
}

function SegmentModal({ segment, onClose }: ModalProps) {
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (!loaded && !loading) {
    setLoading(true)
    fetch(`/api/admin/customers?segment=${segment.key}&limit=50`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setCustomers(d.customers || []); setLoaded(true) })
      .catch(() => { setCustomers([]); setLoaded(true) })
      .finally(() => setLoading(false))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-elevated rounded-2xl border border-border-default shadow-2xl w-[95vw] max-w-[1400px] h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0 border-b border-border-default">
          <div>
            <h2 className="text-base font-semibold text-foreground">{segment.label}</h2>
            <p className="text-xs text-foreground-muted mt-0.5">{segment.count.toLocaleString('en-IN')} customers in segment</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 divide-x divide-border-default">
          {/* Left: customer list */}
          <div className="flex flex-col w-2/5 shrink-0 bg-surface-secondary/30">
            <div className="px-6 pt-4 pb-2 shrink-0 border-b border-border-default">
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Customers</h3>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 divide-y divide-border-default">
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <span className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {loaded && customers?.length === 0 && (
                <p className="text-sm text-foreground-muted py-4">No customers found.</p>
              )}
              {customers?.map(c => <CustomerRow key={c.id} c={c} large />)}
            </div>
          </div>

          {/* Right: campaign panel */}
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center justify-between px-6 pt-4 pb-2 shrink-0">
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Campaign</h3>
              <Link
                href={`/admin/customers?segment=${segment.key}`}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                onClick={onClose}
              >
                View all in Customers →
              </Link>
            </div>
            <div className="overflow-y-auto flex-1 px-6 pb-6">
              <CrmCampaignPanel
                defaultKind={segment.defaultCampaign}
                recipientCount={segment.count}
                onClose={onClose}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const CAMPAIGN_FOR: Record<string, string> = {
  at_risk: 'winback_90',
  dormant: 'winback_180',
}
const DEFAULT_CAMPAIGN = 'winback_90'

export default function SegmentsCard({ segments }: {
  segments: Record<string, number>
}) {
  const [activeSegment, setActiveSegment] = useState<SegmentMeta | null>(null)

  const SEGMENT_META: { key: string; label: string; color: string }[] = [
    { key: 'vip',      label: 'VIP',        color: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700' },
    { key: 'loyal',    label: 'Loyal',      color: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700' },
    { key: 'b2b',      label: 'B2B',        color: 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700' },
    { key: 'repeat',   label: 'Repeat',     color: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' },
    { key: 'new',      label: 'New (<30d)', color: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700' },
    { key: 'at_risk',  label: 'At Risk',    color: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700' },
    { key: 'dormant',  label: 'Dormant',    color: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700' },
    { key: 'one_time', label: 'One-Time',   color: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700' },
    { key: 'lead',     label: 'Lead',       color: 'bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-700' },
  ]

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Segments</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {SEGMENT_META.map(({ key, label, color }) => {
            const count = segments[key] ?? 0
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveSegment({
                  key,
                  label,
                  count,
                  color,
                  defaultCampaign: CAMPAIGN_FOR[key] ?? DEFAULT_CAMPAIGN,
                })}
                className={`group rounded-xl border px-4 py-3 text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${color}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</span>
                  <span className="text-2xl font-bold tabular-nums">{count.toLocaleString('en-IN')}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {activeSegment && (
        <SegmentModal
          segment={activeSegment}
          onClose={() => setActiveSegment(null)}
        />
      )}
    </>
  )
}

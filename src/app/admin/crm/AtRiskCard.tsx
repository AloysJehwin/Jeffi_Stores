'use client'

import { useState } from 'react'
import Link from 'next/link'
import CrmCampaignPanel from './CrmCampaignPanel'

interface AtRiskEntry {
  id: string
  name: string
  email: string
  lastOrderAt: string
  ltv: number
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Row({ c, large }: { c: AtRiskEntry; large?: boolean }) {
  return (
    <Link
      href={`/admin/customers/${c.id}`}
      className={`flex items-center justify-between gap-3 ${large ? 'py-2.5' : 'py-2'} hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
        <p className="text-[11px] text-foreground-muted">
          <span className="hover:underline">{c.email}</span>
          {' · '}Last order {fmtDate(c.lastOrderAt)} · LTV ₹{Math.round(c.ltv).toLocaleString('en-IN')}
        </p>
      </div>
      <span className="text-xs text-orange-600 dark:text-orange-400 font-semibold whitespace-nowrap shrink-0">Win back →</span>
    </Link>
  )
}

export default function AtRiskCard({ items }: { items: AtRiskEntry[] }) {
  const [open, setOpen] = useState(false)
  const preview = items.slice(0, 3)
  const hasMore = items.length > 3

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Just Crossed Into At-Risk</h2>
          <div className="flex items-center gap-3">
            {hasMore && (
              <button
                onClick={() => setOpen(true)}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
              >
                View all ({items.length}) →
              </button>
            )}
            {!hasMore && (
              <Link href="/admin/customers?segment=at_risk" className="text-xs text-accent-500 hover:text-accent-600 font-medium">
                View all →
              </Link>
            )}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">No customers crossed into at-risk this week.</p>
        ) : (
          <div className="divide-y divide-border-default">
            {preview.map(c => <Row key={c.id} c={c} />)}
            {hasMore && (
              <button
                onClick={() => setOpen(true)}
                className="w-full text-center text-xs text-foreground-muted hover:text-foreground pt-2.5 pb-0.5 transition-colors"
              >
                +{items.length - 3} more
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface-elevated rounded-2xl border border-border-default p-6 w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-foreground">Just Crossed Into At-Risk</h2>
                <p className="text-xs text-foreground-muted mt-0.5">{items.length} customers · last order 90–97 days ago</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-border-default flex-1">
              {items.map(c => <Row key={c.id} c={c} large />)}
            </div>
            <div className="pt-4 shrink-0 border-t border-border-default mt-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Campaign</h3>
                <Link
                  href="/admin/customers?segment=at_risk"
                  className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                  onClick={() => setOpen(false)}
                >
                  View all in Customers →
                </Link>
              </div>
              <CrmCampaignPanel
                defaultKind="winback_90"
                recipientCount={items.length}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import CrmCampaignPanel from './CrmCampaignPanel'

interface ChurnRisk {
  id: string
  name: string
  email: string
  score: number
  ltv: number
  daysSinceLastOrder: number | null
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ml-2 ${
      score < 20 ? 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200'
                 : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    }`}>
      {score}
    </span>
  )
}

function Row({ c, large }: { c: ChurnRisk; large?: boolean }) {
  return (
    <Link
      href={`/admin/customers/${c.id}`}
      className={`flex items-center justify-between ${large ? 'text-sm py-2.5' : 'text-sm py-1'} hover:bg-surface-secondary/50 px-2 -mx-2 rounded transition-colors`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate font-medium">{c.name}</p>
        <p className="text-[10px] text-foreground-muted">
          <span className="hover:underline">{c.email}</span>
          {' · '}₹{Math.round(c.ltv).toLocaleString('en-IN')} lifetime
          {c.daysSinceLastOrder != null && ` · ${c.daysSinceLastOrder}d quiet`}
        </p>
      </div>
      <ScoreBadge score={c.score} />
    </Link>
  )
}

export default function ChurnRisksCard({ items }: { items: ChurnRisk[] }) {
  const [open, setOpen] = useState(false)
  const preview = items.slice(0, 3)
  const hasMore = items.length > 3

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Top Churn Risks</h2>
          {hasMore && (
            <button
              onClick={() => setOpen(true)}
              className="text-xs text-accent-500 hover:text-accent-600 font-medium"
            >
              View all ({items.length}) →
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">No customers below health 40.</p>
        ) : (
          <div className="space-y-0.5">
            {preview.map(c => <Row key={c.id} c={c} />)}
            {hasMore && (
              <button
                onClick={() => setOpen(true)}
                className="w-full text-center text-xs text-foreground-muted hover:text-foreground pt-2 pb-0.5 transition-colors"
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
                <h2 className="text-base font-semibold text-foreground">Top Churn Risks</h2>
                <p className="text-xs text-foreground-muted mt-0.5">{items.length} customers · health score below 40</p>
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
                  href="/admin/campaigns/winback_180"
                  className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                  onClick={() => setOpen(false)}
                >
                  Open campaign page →
                </Link>
              </div>
              <CrmCampaignPanel
                defaultKind="winback_180"
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

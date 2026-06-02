'use client'

import { createPortal } from 'react-dom'

import { useState } from 'react'
import Link from 'next/link'
import CrmCampaignPanel from './CrmCampaignPanel'

interface DropEntry {
  id: string
  name: string
  email: string
  score: number
  delta: number
}

function Row({ c, large }: { c: DropEntry; large?: boolean }) {
  return (
    <Link
      href={`/admin/customers/${c.id}`}
      className={`flex items-center justify-between text-sm ${large ? 'py-2.5' : 'py-1'} hover:bg-surface-secondary/50 px-2 -mx-2 rounded transition-colors`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate font-medium">{c.name}</p>
        <p className="text-[10px] text-foreground-muted">
          <span className="hover:underline">{c.email}</span>
          {' · '}Now at {c.score}/100
        </p>
      </div>
      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 shrink-0 ml-2">
        ▼ {Math.abs(c.delta)}
      </span>
    </Link>
  )
}

export default function BiggestDropsCard({ items }: { items: DropEntry[] }) {
  const [open, setOpen] = useState(false)
  const preview = items.slice(0, 3)
  const hasMore = items.length > 3

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Biggest Drops (7d)</h2>
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
          <p className="text-sm text-foreground-muted">No sharp declines this week.</p>
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

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface-elevated rounded-2xl border border-border-default shadow-2xl w-[95vw] max-w-[1400px] h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0 border-b border-border-default">
              <div>
                <h2 className="text-base font-semibold text-foreground">Biggest Drops (7d)</h2>
                <p className="text-xs text-foreground-muted mt-0.5">{items.length} customers with sharp health decline</p>
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
            <div className="flex flex-1 min-h-0 divide-x divide-border-default">
              <div className="flex flex-col w-2/5 shrink-0 bg-surface-secondary/30">
                <div className="px-6 pt-4 pb-2 shrink-0 border-b border-border-default"><h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Customers</h3></div><div className="overflow-y-auto flex-1 px-6 py-4 divide-y divide-border-default">
                  {items.map(c => <Row key={c.id} c={c} large />)}
                </div>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <div className="flex items-center justify-between px-6 pt-4 pb-2 shrink-0">
                  <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Campaign</h3>
                  <Link
                    href="/admin/customers?segment=at_risk"
                    className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                    onClick={() => setOpen(false)}
                  >
                    View all in Customers →
                  </Link>
                </div>
                <div className="overflow-y-auto flex-1 px-6 pb-6">
                  <CrmCampaignPanel
                    defaultKind="winback_90"
                    recipientCount={items.length}
                    onClose={() => setOpen(false)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      , document.body)}
    </>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
  const [running, setRunning] = useState(false)
  const router = useRouter()
  const preview = items.slice(0, 3)
  const hasMore = items.length > 3

  async function runCampaign() {
    if (!confirm(`Send winback campaign to all ${items.length} customers with sharp health drops?`)) return
    setRunning(true)
    try {
      const res = await fetch('/api/admin/campaigns/winback_90/run', { method: 'POST' })
      if (res.ok) {
        alert('Campaign triggered successfully.')
        router.push('/admin/campaigns/winback_90')
      } else {
        alert('Failed to run campaign. Check Campaigns page.')
      }
    } finally {
      setRunning(false)
    }
  }

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
            <div className="overflow-y-auto divide-y divide-border-default flex-1">
              {items.map(c => <Row key={c.id} c={c} large />)}
            </div>
            <div className="pt-4 shrink-0 border-t border-border-default mt-2 flex items-center justify-between gap-3">
              <Link
                href="/admin/campaigns/winback_90"
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                onClick={() => setOpen(false)}
              >
                View campaign →
              </Link>
              <button
                onClick={runCampaign}
                disabled={running}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
              >
                {running ? (
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )}
                Campaign to all {items.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

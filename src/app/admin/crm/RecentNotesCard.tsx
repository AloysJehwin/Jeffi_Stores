'use client'

import { createPortal } from 'react-dom'

import { useState } from 'react'
import Link from 'next/link'

interface NoteEntry {
  userId: string
  customerName: string
  adminName: string
  body: string
  createdAt: string
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function NoteRow({ n }: { n: NoteEntry }) {
  return (
    <div className="border-l-2 border-accent-500 pl-3 py-1">
      <p className="text-sm text-foreground whitespace-pre-wrap break-words line-clamp-3">{n.body}</p>
      <p className="text-[10px] text-foreground-muted mt-1">
        <Link href={`/admin/customers/${n.userId}`} className="text-accent-600 dark:text-accent-400 hover:underline">
          {n.customerName}
        </Link>
        {' · '}{n.adminName}{' · '}{timeAgo(n.createdAt)}
      </p>
    </div>
  )
}

export default function RecentNotesCard({ items }: { items: NoteEntry[] }) {
  const [open, setOpen] = useState(false)
  const preview = items.slice(0, 3)
  const hasMore = items.length > 3

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5 lg:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Recent Internal Notes</h2>
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
          <p className="text-sm text-foreground-muted">No notes yet. Add one from any customer page to track conversations.</p>
        ) : (
          <div className="space-y-3">
            {preview.map((n, i) => <NoteRow key={i} n={n} />)}
            {hasMore && (
              <button
                onClick={() => setOpen(true)}
                className="w-full text-center text-xs text-foreground-muted hover:text-foreground pt-1 pb-0.5 transition-colors"
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
            className="bg-surface-elevated rounded-2xl border border-border-default p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-foreground">Recent Internal Notes</h2>
                <p className="text-xs text-foreground-muted mt-0.5">{items.length} notes</p>
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
            <div className="overflow-y-auto space-y-3">
              {items.map((n, i) => <NoteRow key={i} n={n} />)}
            </div>
          </div>
        </div>
      , document.body)}
    </>
  )
}

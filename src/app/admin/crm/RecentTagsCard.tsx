'use client'

import { createPortal } from 'react-dom'

import { useState } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'

interface TagEntry {
  userId: string
  name: string
  tag: string
  createdAt: string
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function TagRow({ t }: { t: TagEntry }) {
  return (
    <Link
      href={ap(`/admin/customers/${t.userId}`)}
      className="flex items-center justify-between gap-3 py-2 hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
        <span className="inline-block px-2 py-0.5 mt-0.5 bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 rounded-full text-[10px] font-medium">
          {t.tag}
        </span>
      </div>
      <span className="text-[10px] text-foreground-muted whitespace-nowrap">{timeAgo(t.createdAt)}</span>
    </Link>
  )
}

export default function RecentTagsCard({ items }: { items: TagEntry[] }) {
  const [open, setOpen] = useState(false)
  const preview = items.slice(0, 5)
  const hasMore = items.length > 5

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Recently Tagged</h2>
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
          <p className="text-sm text-foreground-muted">No recent tag activity.</p>
        ) : (
          <div className="divide-y divide-border-default">
            {preview.map((t, i) => <TagRow key={i} t={t} />)}
            {hasMore && (
              <button
                onClick={() => setOpen(true)}
                className="w-full text-center text-xs text-foreground-muted hover:text-foreground pt-2.5 pb-0.5 transition-colors"
              >
                +{items.length - 5} more
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
                <h2 className="text-base font-semibold text-foreground">Recently Tagged</h2>
                <p className="text-xs text-foreground-muted mt-0.5">{items.length} tag events</p>
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
            <div className="overflow-y-auto divide-y divide-border-default">
              {items.map((t, i) => <TagRow key={i} t={t} />)}
            </div>
          </div>
        </div>
      , document.body)}
    </>
  )
}

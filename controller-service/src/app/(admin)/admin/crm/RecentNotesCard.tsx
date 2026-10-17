'use client'

import { Dialog } from '@/components/admin/kit'

import { useState } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'

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
        <Link
          href={ap(`/admin/customers/${n.userId}/view`)}
          className="text-accent-500 hover:underline"
        >
          {n.customerName}
        </Link>
        {' · '}
        {n.adminName}
        {' · '}
        {timeAgo(n.createdAt)}
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
            Recent Internal Notes
          </h2>
          {hasMore && (
            <button onClick={() => setOpen(true)} className="text-xs text-accent-500 hover:text-accent-600 font-medium">
              View all ({items.length}) →
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            No notes yet. Add one from any customer page to track conversations.
          </p>
        ) : (
          <div className="space-y-3">
            {preview.map((n, i) => (
              <NoteRow key={i} n={n} />
            ))}
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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Recent Internal Notes"
        description={<>{items.length} notes</>}
        size="md"
        zIndex="z-[300]"
      >
        <div className="space-y-3">
                {items.map((n, i) => (
                  <NoteRow key={i} n={n} />
                ))}
              </div>
      </Dialog>
    </>
  )
}

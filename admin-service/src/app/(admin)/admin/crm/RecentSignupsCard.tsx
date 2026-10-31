'use client'

import { Dialog } from '@/components/admin/kit'

import { useState } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'

interface SignupEntry {
  id: string
  name: string
  email: string
  createdAt: string
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function SignupRow({ s }: { s: SignupEntry }) {
  return (
    <Link
      href={ap(`/admin/customers/${s.id}/view`)}
      className="flex items-center justify-between gap-3 py-2 hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
        <p className="text-[11px] text-foreground-muted truncate hover:underline">{s.email}</p>
      </div>
      <span className="text-[10px] text-foreground-muted whitespace-nowrap">{timeAgo(s.createdAt)}</span>
    </Link>
  )
}

export default function RecentSignupsCard({ items }: { items: SignupEntry[] }) {
  const [open, setOpen] = useState(false)
  const preview = items.slice(0, 5)
  const hasMore = items.length > 5

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Recent Signups</h2>
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
              <Link
                href={ap('/admin/customers?segment=lead')}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
              >
                View leads →
              </Link>
            )}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">No new signups yet.</p>
        ) : (
          <div className="divide-y divide-border-default">
            {preview.map(s => (
              <SignupRow key={s.id} s={s} />
            ))}
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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Recent Signups"
        description={<>{items.length} new customers</>}
        size="md"
        zIndex="z-[300]"
      >
        <div className="divide-y divide-border-default">
          {items.map(s => (
            <SignupRow key={s.id} s={s} />
          ))}
        </div>
        <div className="pt-4 shrink-0 border-t border-border-default mt-2">
          <Link
            href={ap('/admin/customers?segment=lead')}
            className="block text-center text-xs text-accent-500 hover:text-accent-600 font-medium"
            onClick={() => setOpen(false)}
          >
            View all leads in Customers →
          </Link>
        </div>
      </Dialog>
    </>
  )
}

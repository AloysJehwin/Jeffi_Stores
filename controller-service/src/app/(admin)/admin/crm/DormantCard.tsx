'use client'

import { Dialog } from '@/components/admin/kit'
import { useHasScope } from '@/contexts/AdminScopesContext'

import { useState } from 'react'
import Link from 'next/link'
import CrmMailerPanel from './CrmMailerPanel'
import { ap } from '@/lib/shared/admin-path'

interface DormantEntry {
  id: string
  name: string
  email: string
  lastOrderAt: string
  ltv: number
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Row({ c, large }: { c: DormantEntry; large?: boolean }) {
  return (
    <Link
      href={ap(`/admin/customers/${c.id}/view`)}
      className={`flex items-center justify-between gap-3 ${large ? 'py-2.5' : 'py-2'} hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
        <p className="text-[11px] text-foreground-muted">
          <span className="hover:underline">{c.email}</span>
          {' · '}Last order {fmtDate(c.lastOrderAt)} · LTV ₹{Math.round(c.ltv).toLocaleString('en-IN')}
        </p>
      </div>
      <span className="text-xs text-red-600 dark:text-red-400 font-semibold whitespace-nowrap shrink-0">
        High value
      </span>
    </Link>
  )
}

export default function DormantCard({ items }: { items: DormantEntry[] }) {
  const canMail = useHasScope('mailer:write')
  const [open, setOpen] = useState(false)
  const preview = items.slice(0, 3)
  const hasMore = items.length > 3

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Dormant — Top by LTV</h2>
          <div className="flex items-center gap-3">
            {items.length > 0 && (
              <button
                onClick={() => setOpen(true)}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
              >
                {hasMore ? `View all (${items.length}) →` : 'View all →'}
              </button>
            )}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">No dormant customers.</p>
        ) : (
          <div className="divide-y divide-border-default">
            {preview.map(c => (
              <Row key={c.id} c={c} />
            ))}
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

      <Dialog open={open} onClose={() => setOpen(false)} title="Dormant — Top by LTV" description={<>{items.length} high-value dormant customers</>} size="full" zIndex="z-[300]">
              <div className="flex flex-1 min-h-0 flex-col overflow-y-auto divide-y divide-border-default md:flex-row md:overflow-hidden md:divide-y-0 md:divide-x">
                <div className={`flex flex-col bg-surface-secondary/30 ${canMail ? 'shrink-0 md:w-2/5' : 'flex-1'}`}>
                  <div className="px-6 pt-4 pb-2 shrink-0 border-b border-border-default">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Customers</h3>
                  </div>
                  <div className="overflow-y-auto flex-1 px-6 py-4 divide-y divide-border-default">
                    {items.map(c => (
                      <Row key={c.id} c={c} large />
                    ))}
                  </div>
                </div>
                {canMail && (
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center justify-between px-6 pt-4 pb-2 shrink-0">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Send message</h3>
                      <Link
                        href={ap('/admin/customers?segment=dormant')}
                        className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                        onClick={() => setOpen(false)}
                      >
                        View all in Customers →
                      </Link>
                    </div>
                    <div className="overflow-y-auto flex-1 px-6 pb-6">
                      <CrmMailerPanel
                        segmentKey="dormant"
                        segmentLabel="Dormant"
                        recipientCount={items.length}
                        onClose={() => setOpen(false)}
                      />
                    </div>
                  </div>
                )}
              </div>
      </Dialog>
    </>
  )
}

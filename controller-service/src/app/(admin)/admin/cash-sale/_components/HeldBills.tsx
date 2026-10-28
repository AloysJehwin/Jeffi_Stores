'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ReceiptText } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { timeAgo } from '@/lib/client/draft-lock-client'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { EmptyState } from '@/components/admin/kit'

interface HeldBill {
  id: string
  label: string | null
  line_count: number
  total_estimate: string
  updated_at: string
  admin_name: string | null
  lock: { ownerName: string | null; mine: boolean } | null
}

const inr = (n: string | number) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Bills parked at the counter: no invoice number or stock change until Complete Sale. */
export default function HeldBills() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('invoices')
  const [bills, setBills] = useState<HeldBill[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/admin/invoices/cash-sale/drafts', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { drafts: [] }))
      .then(j => setBills(j.drafts || []))
      .catch(() => setBills([]))
  }, [])
  useEffect(load, [load])

  async function discard(b: HeldBill) {
    const ok = await confirm({
      title: 'Discard held bill',
      message: `Discard "${b.label || 'Held bill'}"? Its items are not sold and nothing changes in stock.`,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep',
      variant: 'danger',
    })
    if (!ok) return
    setBusyId(b.id)
    try {
      const res = await fetch(`/api/admin/invoices/cash-sale/drafts/${b.id}`, { method: 'DELETE', credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return showToast(j.error || 'Could not discard the bill', 'error')
      showToast('Held bill discarded', 'success')
      load()
    } finally {
      setBusyId(null)
    }
  }

  if (!bills) return null
  if (!bills.length) return <EmptyState title="No held bills" body="Use Hold Bill on a sale to park it and serve the next customer." />
  return (
    <section className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
      <ul className="divide-y divide-border-default">
        {bills.map(b => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <ReceiptText className="h-4 w-4 shrink-0 text-foreground-muted" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{b.label || 'Held bill'}</p>
                <p className="text-xs text-foreground-muted">
                  {b.line_count} item{b.line_count === 1 ? '' : 's'} · ₹{inr(b.total_estimate)} · held by {b.admin_name || 'someone'} · {timeAgo(b.updated_at)}
                  {b.lock && !b.lock.mine && ` · being rung up by ${b.lock.ownerName || 'another cashier'}`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canWrite && (
                <button
                  type="button"
                  onClick={() => discard(b)}
                  disabled={busyId === b.id}
                  className="control-sm inline-flex items-center border border-border-default text-xs font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                >
                  Discard
                </button>
              )}
              <Link
                href={ap(`/admin/cash-sale?draft=${b.id}`)}
                className="control-sm inline-flex items-center border border-accent-500/40 bg-accent-500/10 text-xs font-semibold text-accent-500 hover:bg-accent-500/20"
              >
                Resume
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FilePen } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { timeAgo } from '@/lib/client/draft-lock-client'

interface PoDraft {
  id: string
  supplier_name: string | null
  line_count: number
  updated_at: string
}

/** New purchase orders this admin started and hasn't created yet, for the Drafts tab. */
export default function PurchaseOrderDrafts() {
  const [drafts, setDrafts] = useState<PoDraft[] | null>(null)

  useEffect(() => {
    fetch('/api/admin/inventory/po/draft', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { drafts: [] }))
      .then(j => setDrafts(j.drafts || []))
      .catch(() => setDrafts([]))
  }, [])

  if (!drafts?.length) return null
  return (
    <section className="overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <FilePen className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-semibold text-foreground">Your purchase orders in progress</span>
        </div>
        <p className="text-xs text-foreground-muted">Resume where you left off</p>
      </div>
      <ul className="divide-y divide-amber-500/20">
        {drafts.map(d => (
          <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{d.supplier_name || 'No supplier yet'}</p>
              <p className="text-xs text-foreground-muted">
                {d.line_count} line{d.line_count === 1 ? '' : 's'} · edited {timeAgo(d.updated_at)}
              </p>
            </div>
            <Link
              href={ap(`/admin/purchase-orders/new?draftId=${d.id}`)}
              className="control-sm inline-flex shrink-0 items-center border border-accent-500/40 bg-accent-500/10 text-xs font-semibold text-accent-500 hover:bg-accent-500/20"
            >
              Resume
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

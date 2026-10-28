'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { timeAgo } from '@/lib/client/draft-lock-client'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface ScenarioDraft {
  id: string
  title: string | null
  name: string | null
  step: string | null
  updated_at: string
  admin_name: string | null
  lock: { ownerName: string | null; mine: boolean } | null
}

const STEP_LABEL: Record<string, string> = { describe: 'describing', review_sql: 'reviewing SQL', dry_run: 'dry run', save: 'naming' }

/** New-scenario wizards left part-way, with Resume / Discard. Hidden when there are none. */
export default function ScenarioDrafts() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('campaigns')
  const [drafts, setDrafts] = useState<ScenarioDraft[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/admin/campaigns/scenarios/drafts', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { drafts: [] }))
      .then(j => setDrafts(j.drafts || []))
      .catch(() => setDrafts([]))
  }, [])
  useEffect(load, [load])

  async function discard(d: ScenarioDraft) {
    const ok = await confirm({
      title: 'Discard scenario draft',
      message: `Discard "${d.title || d.name || 'Untitled scenario'}"? The generated SQL and dry run are lost.`,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep',
      variant: 'danger',
    })
    if (!ok) return
    setBusyId(d.id)
    try {
      const res = await fetch(`/api/admin/campaigns/scenarios/drafts/${d.id}`, { method: 'DELETE', credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return showToast(j.error || 'Could not discard the draft', 'error')
      showToast('Scenario draft discarded', 'success')
      load()
    } finally {
      setBusyId(null)
    }
  }

  if (!drafts.length) return null
  return (
    <section className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
      <p className="border-b border-border-default px-4 py-2.5 text-sm font-semibold text-foreground">Scenarios in progress</p>
      <ul className="divide-y divide-border-default">
        {drafts.map(d => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Sparkles className="h-4 w-4 shrink-0 text-foreground-muted" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{d.title || d.name || 'Untitled scenario'}</p>
                <p className="text-xs text-foreground-muted">
                  {d.step ? `${STEP_LABEL[d.step] ?? d.step} · ` : ''}started by {d.admin_name || 'someone'} · {timeAgo(d.updated_at)}
                  {d.lock && !d.lock.mine && ` · being edited by ${d.lock.ownerName || 'another admin'}`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canWrite && (
                <button
                  type="button"
                  onClick={() => discard(d)}
                  disabled={busyId === d.id}
                  className="control-sm inline-flex items-center border border-border-default text-xs font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                >
                  Discard
                </button>
              )}
              <Link
                href={ap(`/admin/campaigns/scenarios/new?draft=${d.id}`)}
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

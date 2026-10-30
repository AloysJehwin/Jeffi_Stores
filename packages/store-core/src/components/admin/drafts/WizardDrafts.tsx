'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { timeAgo } from '@/lib/client/draft-lock-client'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

export interface WizardDraftRow {
  id: string
  title: string | null
  updated_at: string
  admin_name: string | null
  lock: { ownerName: string | null; mine: boolean } | null
  [key: string]: unknown
}

interface Props {
  /** List / item endpoint of a json-drafts collection (GET list, DELETE /:id). */
  endpoint: string
  heading: string
  icon: ReactNode
  writeScope: string
  label: (d: WizardDraftRow) => string
  /** Prefix of the detail line, e.g. "reviewing SQL". */
  detail?: (d: WizardDraftRow) => string | null
  /** Resume target: a link, or a callback when the wizard opens in place. */
  resumeHref?: (id: string) => string
  onResume?: (id: string) => void
  discardMessage: string
}

/** Wizards left part-way (json-drafts), with Resume / Discard. Hidden when there are none. */
export default function WizardDrafts({ endpoint, heading, icon, writeScope, label, detail, resumeHref, onResume, discardMessage }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite(writeScope)
  const [drafts, setDrafts] = useState<WizardDraftRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(endpoint, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { drafts: [] }))
      .then(j => setDrafts(j.drafts || []))
      .catch(() => setDrafts([]))
  }, [endpoint])
  useEffect(load, [load])

  async function discard(d: WizardDraftRow) {
    const ok = await confirm({
      title: 'Discard draft',
      message: `Discard "${label(d)}"? ${discardMessage}`,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep',
      variant: 'danger',
    })
    if (!ok) return
    setBusyId(d.id)
    try {
      const res = await fetch(`${endpoint}/${d.id}`, { method: 'DELETE', credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return showToast(j.error || 'Could not discard the draft', 'error')
      showToast('Draft discarded', 'success')
      load()
    } finally {
      setBusyId(null)
    }
  }

  if (!drafts.length) return null
  const resumeCls =
    'control-sm inline-flex items-center border border-accent-500/40 bg-accent-500/10 text-xs font-semibold text-accent-500 hover:bg-accent-500/20'
  return (
    <section className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
      <p className="border-b border-border-default px-4 py-2.5 text-sm font-semibold text-foreground">{heading}</p>
      <ul className="divide-y divide-border-default">
        {drafts.map(d => {
          const pre = detail?.(d)
          return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 text-foreground-muted">{icon}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{label(d)}</p>
                  <p className="text-xs text-foreground-muted">
                    {pre ? `${pre} · ` : ''}started by {d.admin_name || 'someone'} · {timeAgo(d.updated_at)}
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
                {onResume ? (
                  <button type="button" onClick={() => onResume(d.id)} className={resumeCls}>
                    Resume
                  </button>
                ) : resumeHref ? (
                  <Link href={resumeHref(d.id)} className={resumeCls}>
                    Resume
                  </Link>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

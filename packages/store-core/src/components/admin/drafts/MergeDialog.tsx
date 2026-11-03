'use client'

import { useEffect, useState } from 'react'
import { Dialog } from '@/components/admin/kit/dialog'
import { FormButton } from '@/components/admin/kit/form'
import type { MergeConflict } from '@/lib/admin/draft-merge'

// Publishing a draft whose fields were also changed by someone else since it started: show each
// overlapping field (what it was, what they set, what you set) and let the publisher pick per field.

type Pick = 'mine' | 'theirs'

const ghost =
  'control-md inline-flex items-center border border-border-secondary bg-surface text-foreground-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50'

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return s.length > 160 ? `${s.slice(0, 157)}…` : s
  }
  const s = String(v)
  return s.length > 240 ? `${s.slice(0, 237)}…` : s
}

const when = (at?: string | null) => (at ? new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null)

/** POSTs { resolutions } to the publish URL; a 409 DRAFT_CONFLICT reply lands here. */
export async function publishWithResolutions(
  publishPath: string,
  resolutions: Record<string, Pick> = {},
  extraBody: Record<string, unknown> = {}
): Promise<{ ok: true } | { ok: false; conflicts?: MergeConflict[]; error: string }> {
  const res = await fetch(publishPath, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...extraBody, resolutions }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok) return { ok: true }
  if (res.status === 409 && data.code === 'DRAFT_CONFLICT') return { ok: false, conflicts: data.conflicts ?? [], error: data.error }
  return { ok: false, error: data.error || 'Publish failed' }
}

export default function MergeDialog({
  open,
  onClose,
  onDone,
  publishPath,
  conflicts: initial,
  extraBody,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  publishPath: string
  conflicts: MergeConflict[]
  extraBody?: Record<string, unknown>
}) {
  const [conflicts, setConflicts] = useState(initial)
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setConflicts(initial)
    setPicks({})
    setError(null)
  }, [open, initial])

  const all = (p: Pick) => setPicks(Object.fromEntries(conflicts.map(c => [c.path, p])))
  const ready = conflicts.every(c => picks[c.path])

  async function submit() {
    setBusy(true)
    setError(null)
    const r = await publishWithResolutions(publishPath, picks, extraBody)
    setBusy(false)
    if (r.ok) return onDone()
    // Someone published again while the dialog was open: show the new overlaps, keep the picks that still apply.
    if (r.conflicts?.length) {
      setConflicts(r.conflicts)
      setPicks(p => Object.fromEntries(r.conflicts!.filter(c => p[c.path]).map(c => [c.path, p[c.path]])))
    }
    setError(r.error)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Live changed while you edited"
      description={`${conflicts.length} field${conflicts.length === 1 ? '' : 's'} you changed ${conflicts.length === 1 ? 'was' : 'were'} also changed and published by someone else. Choose what to keep — everything else merges as is.`}
      footer={
        <>
          <button type="button" className={ghost} onClick={onClose}>
            Cancel
          </button>
          <FormButton type="button" disabled={!ready || busy} onClick={submit}>
            {busy ? 'Publishing…' : 'Publish'}
          </FormButton>
        </>
      }
    >
      <div className="flex items-center gap-2 mb-3 text-xs">
        <button type="button" className={ghost} onClick={() => all('mine')}>
          Keep all mine
        </button>
        <button type="button" className={ghost} onClick={() => all('theirs')}>
          Take all theirs
        </button>
      </div>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {conflicts.map(c => (
          <div key={c.path} className="rounded-lg border border-border-secondary p-3">
            <p className="text-sm font-semibold text-foreground">{c.label}</p>
            <p className="text-xs text-foreground-muted mb-2">Was: {show(c.base)}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['theirs', 'mine'] as const).map(side => (
                <label
                  key={side}
                  className={`cursor-pointer rounded-md border p-2 text-sm transition-colors ${
                    picks[c.path] === side ? 'border-accent-500 bg-accent-500/10' : 'border-border-secondary hover:bg-surface-secondary'
                  }`}
                >
                  <span className="flex items-center gap-2 text-xs font-medium text-foreground-secondary">
                    <input type="radio" name={c.path} checked={picks[c.path] === side} onChange={() => setPicks(p => ({ ...p, [c.path]: side }))} />
                    {side === 'mine' ? 'Yours' : `${c.theirsBy ?? 'Live'}${when(c.theirsAt) ? ` · ${when(c.theirsAt)}` : ''}`}
                  </span>
                  <span className="mt-1 block break-words text-foreground">{show(side === 'mine' ? c.mine : c.theirs)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </Dialog>
  )
}

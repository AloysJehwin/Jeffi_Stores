'use client'

import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import type { DraftDiff, HomepageDraftSummary } from '@/lib/catalog/homepage-draft'
import { HOMEPAGE_DRAFT_CHANGED } from './draft-events'

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

function describeDiff(noun: string, diff: DraftDiff): string | null {
  const parts: string[] = []
  const counted = (n: number, verb: string) => (parts.length ? `${n} ${verb}` : `${plural(n, noun)} ${verb}`)
  if (diff.edited) parts.push(counted(diff.edited, 'edited'))
  if (diff.added) parts.push(counted(diff.added, 'added'))
  if (diff.removed) parts.push(counted(diff.removed, 'removed'))
  if (diff.reordered) parts.push(parts.length ? 'order changed' : `${noun} order changed`)
  return parts.length ? parts.join(', ') : null
}

function timeAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${plural(hours, 'hour')} ago` : `${plural(Math.round(hours / 24), 'day')} ago`
}

const hasChanges = (d: DraftDiff) => d.added > 0 || d.removed > 0 || d.edited > 0 || d.reordered

export default function HomepageDraftBar({ initial }: { initial: HomepageDraftSummary }) {
  const { showToast, showConfirm } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [summary, setSummary] = useState(initial)
  const [busy, setBusy] = useState<'publish' | 'discard' | null>(null)
  // Set after mount so the relative time never differs between server and client render.
  const [now, setNow] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/homepage-draft', { credentials: 'include', cache: 'no-store' })
      if (res.ok) setSummary(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined
    function onChange() {
      clearTimeout(pending)
      pending = setTimeout(refresh, 300)
    }
    window.addEventListener(HOMEPAGE_DRAFT_CHANGED, onChange)
    return () => {
      window.removeEventListener(HOMEPAGE_DRAFT_CHANGED, onChange)
      clearTimeout(pending)
    }
  }, [refresh])

  useEffect(() => {
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(tick)
  }, [])

  async function publish() {
    const ok = await showConfirm({
      title: 'Publish the homepage?',
      message: 'Every draft change goes live on the storefront at once.',
      confirmText: 'Publish',
      type: 'info',
    })
    if (!ok) return
    setBusy('publish')
    try {
      const res = await fetch('/api/admin/homepage-draft/publish', { method: 'POST', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Publish failed', 'error')
        return
      }
      showToast('Published - the homepage is live', 'success')
      await refresh()
    } catch {
      showToast('Publish failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function discard() {
    const ok = await showConfirm({
      title: 'Discard the draft?',
      message: 'All unpublished homepage changes will be thrown away. The live homepage stays as it is.',
      confirmText: 'Discard',
      type: 'danger',
    })
    if (!ok) return
    setBusy('discard')
    try {
      const res = await fetch('/api/admin/homepage-draft', { method: 'DELETE', credentials: 'include' })
      if (res.ok) {
        window.location.reload()
        return
      }
      showToast('Failed to discard the draft', 'error')
    } catch {
      showToast('Failed to discard the draft', 'error')
    }
    setBusy(null)
  }

  const pending = summary.hasDraft && (hasChanges(summary.sections) || hasChanges(summary.slides))
  const details = [describeDiff('section', summary.sections), describeDiff('hero slide', summary.slides)]
    .filter(Boolean)
    .join('; ')

  return (
    <div className="sticky top-2 z-20 flex flex-col gap-3 rounded-xl border border-border-default bg-surface-elevated px-4 py-3 shadow-sm sm:flex-row sm:items-center">
      <div className="flex-1 min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${pending ? 'bg-amber-500' : 'bg-emerald-500'}`}
            aria-hidden="true"
          />
          {pending ? 'Unpublished changes' : 'All changes are live'}
        </p>
        {pending && details && <p className="mt-0.5 text-xs text-foreground-secondary">{details}</p>}
        {pending && summary.updatedAt && now !== null && (
          <p className="mt-0.5 text-[11px] text-foreground-muted">
            Last edited {timeAgo(summary.updatedAt, now)}
            {summary.updatedBy ? ` by ${summary.updatedBy}` : ''}
          </p>
        )}
      </div>

      {canWrite && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={discard}
            disabled={!pending || busy !== null}
            className="rounded-lg border border-border-default px-3 py-1.5 text-sm text-foreground hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'discard' ? 'Discarding...' : 'Discard'}
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={!pending || busy !== null}
            className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'publish' ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      )}
    </div>
  )
}

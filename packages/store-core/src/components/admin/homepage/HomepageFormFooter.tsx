'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useEditSession } from '@/hooks/useEditSession'
import AutosaveStatusPill from '@/components/admin/AutosaveStatusPill'
import { Badge, FormButton, FormFooter } from '@/components/admin/kit'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'
import type { DraftDiff, HomepageDraftSummary } from '@/lib/catalog/homepage-draft'
import type { MergeConflict } from '@/lib/admin/draft-merge'
import MergeDialog from '@/components/admin/drafts/MergeDialog'
import { HOMEPAGE_DRAFT_CHANGED } from './draft-events'
import { useHomepageLock } from './HomepageLock'

const hasChanges = (d: DraftDiff) => d.added > 0 || d.removed > 0 || d.edited > 0 || d.reordered

const SURFACE_LABEL = { web: 'desktop web', web_mobile: 'mobile web', app: 'app' } as const

/** Which layouts the draft touches: "desktop web", "app", "desktop web + mobile web" and so on. */
function touchedSurfaces(summary: HomepageDraftSummary): string {
  const names = (['web', 'web_mobile', 'app'] as const)
    .filter(s => hasChanges(summary.bySurface[s].sections) || hasChanges(summary.bySurface[s].slides))
    .map(s => SURFACE_LABEL[s])
  return names.join(' + ')
}

interface Props {
  draftId: string
  initialSummary: HomepageDraftSummary
  cancelHref: string
  /** The live homepage view, where publish and discard land. */
  liveHref: string
  /** Server action that resnapshots the admin's open session on the draft so Cancel reverts to A2. */
  resnapshotAction: (draftId: string) => Promise<void>
}

// The homepage editor's only action bar. Every section/slide change autosaves to the open draft
// via the sections API; this bar shows the autosave pill and Draft pending badge, and owns Discard,
// Cancel (rolls the draft back to the session snapshot), Save as Draft (resnapshots so Cancel
// reverts here) and Publish (merges the draft into live; overlapping edits open the merge dialog).
export default function HomepageFormFooter({ draftId, initialSummary, cancelHref, liveHref, resnapshotAction }: Props) {
  const router = useRouter()
  const { showToast, showConfirm } = useToast()
  // The session opens only for the lock holder (or on an unclaimed draft, which claims it).
  const homepage = useHomepageLock()
  const edit = useEditSession({ resourceType: 'homepage', resourceId: homepage.lockId, lock: homepage.lock })
  const [summary, setSummary] = useState(initialSummary)
  const [autosave, setAutosave] = useState<AutosaveStatus>('idle')
  const [busy, setBusy] = useState<'publish' | 'discard' | 'draft' | null>(null)
  const [conflicts, setConflicts] = useState<MergeConflict[] | null>(null)
  const publishPath = `/api/admin/homepage-draft/publish?draft=${draftId}`
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveBlockedRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/homepage-draft?draft=${draftId}`, { credentials: 'include', cache: 'no-store' })
      if (res.ok) setSummary(await res.json())
    } catch {}
  }, [draftId])

  // Each successful section/slide write dispatches HOMEPAGE_DRAFT_CHANGED. Reflect
  // that as a brief "Saved" flash and refresh the diff summary. Autosave itself
  // never resnapshots — only the explicit Save as Draft does.
  useEffect(() => {
    const onChange = () => {
      if (autosaveBlockedRef.current) return
      setAutosave('saved')
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => setAutosave('idle'), 2000)
      void refresh()
    }
    window.addEventListener(HOMEPAGE_DRAFT_CHANGED, onChange)
    return () => {
      window.removeEventListener(HOMEPAGE_DRAFT_CHANGED, onChange)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [refresh])

  const pending = summary.hasDraft && (hasChanges(summary.sections) || hasChanges(summary.slides))
  const touched = pending ? touchedSurfaces(summary) : ''

  async function handleDiscard() {
    const ok = await showConfirm({
      title: 'Discard this draft?',
      message: 'Its unpublished homepage changes will be thrown away. The live homepage and other drafts stay as they are.',
      confirmText: 'Discard',
      type: 'danger',
    })
    if (!ok) return
    autosaveBlockedRef.current = true
    setBusy('discard')
    try {
      const res = await fetch('/api/admin/homepage-draft', { method: 'DELETE', credentials: 'include', headers: homepage.headers() })
      if (!res.ok) {
        autosaveBlockedRef.current = false
        if (!(await homepage.locked(res))) showToast('Failed to discard the draft', 'error')
        setBusy(null)
        return
      }
      // Close the session now that the draft is gone — no snapshot to roll back to.
      if (edit.sessionId) await edit.save()
      router.push(liveHref)
      router.refresh()
    } catch {
      autosaveBlockedRef.current = false
      showToast('Failed to discard the draft', 'error')
      setBusy(null)
    }
  }

  async function published() {
    // The draft is merged and gone: close the session and show the live homepage.
    if (edit.sessionId) await edit.save()
    showToast('Published - the homepage is live', 'success')
    router.push(liveHref)
    router.refresh()
  }

  async function handlePublish() {
    const ok = await showConfirm({
      title: 'Publish this draft?',
      message: `Its changes go live at once${touched ? ` on the ${touched}` : ''}. Changes others published meanwhile are kept.`,
      confirmText: 'Publish',
      type: 'info',
    })
    if (!ok) return
    autosaveBlockedRef.current = true
    setBusy('publish')
    try {
      const res = await fetch(publishPath, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...homepage.headers() },
        body: '{}',
      })
      if (await homepage.locked(res)) {
        autosaveBlockedRef.current = false
        setBusy(null)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.code === 'DRAFT_CONFLICT') {
        autosaveBlockedRef.current = false
        setBusy(null)
        setConflicts(data.conflicts ?? [])
        return
      }
      if (!res.ok) {
        autosaveBlockedRef.current = false
        showToast(data.error || 'Publish failed', 'error')
        setBusy(null)
        return
      }
      await published()
    } catch {
      autosaveBlockedRef.current = false
      showToast('Publish failed', 'error')
      setBusy(null)
    }
  }

  async function handleSaveAsDraft() {
    setBusy('draft')
    try {
      // The draft row is already live via section/slide autosaves. Resnapshot the
      // open session so Cancel reverts to this exact state (A2), not A1.
      await resnapshotAction(draftId)
      showToast('Draft saved - Cancel will revert to this point', 'success')
    } catch {
      showToast('Failed to save draft', 'error')
    }
    setBusy(null)
  }

  async function handleCancel() {
    autosaveBlockedRef.current = true
    const ok = await edit.cancel()
    if (!ok) {
      autosaveBlockedRef.current = false
      showToast('Failed to cancel', 'error')
      return
    }
    router.push(cancelHref)
    router.refresh()
  }

  return (
    <>
    {conflicts && (
      <MergeDialog
        open
        conflicts={conflicts}
        publishPath={publishPath}
        onClose={() => setConflicts(null)}
        onDone={() => {
          setConflicts(null)
          void published()
        }}
      />
    )}
    <FormFooter
      sticky
      lock={homepage.lock}
      autosave={autosave !== 'idle' ? <AutosaveStatusPill status={autosave} /> : null}
      draftBadge={pending ? <Badge tone="amber">Draft pending{touched ? ` · ${touched}` : ''}</Badge> : null}
      discard={pending ? handleDiscard : undefined}
      cancel={edit.sessionId ? handleCancel : undefined}
      cancelHref={edit.sessionId ? undefined : cancelHref}
    >
      <RequireWrite scope="settings:write">
        <FormButton
          type="button"
          variant="secondary"
          disabled={busy !== null || !pending}
          onClick={handleSaveAsDraft}
        >
          {busy === 'draft' ? 'Saving...' : 'Save as Draft'}
        </FormButton>
        <FormButton type="button" disabled={busy !== null || !pending} onClick={handlePublish}>
          {busy === 'publish' ? 'Publishing...' : 'Publish'}
        </FormButton>
      </RequireWrite>
    </FormFooter>
    </>
  )
}

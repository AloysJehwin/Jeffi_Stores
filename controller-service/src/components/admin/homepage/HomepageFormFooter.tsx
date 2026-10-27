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
import { HOMEPAGE_DRAFT_CHANGED } from './draft-events'
import { useHomepageLock } from './HomepageLock'

const hasChanges = (d: DraftDiff) => d.added > 0 || d.removed > 0 || d.edited > 0 || d.reordered

const SURFACE_LABEL = { web: 'website', app: 'mobile app' } as const

/** Which layouts the draft touches: "website", "mobile app" or "website + mobile app". */
function touchedSurfaces(summary: HomepageDraftSummary): string {
  const names = (['web', 'app'] as const)
    .filter(s => hasChanges(summary.bySurface[s].sections) || hasChanges(summary.bySurface[s].slides))
    .map(s => SURFACE_LABEL[s])
  return names.join(' + ')
}

interface Props {
  initialSummary: HomepageDraftSummary
  cancelHref: string
  /** Server action that resnapshots the admin's open homepage session so Cancel reverts to A2. */
  resnapshotAction: () => Promise<void>
}

// One shared bottom bar for the homepage editor. Replaces HomepageDraftBar (top
// sticky) and HomepageEditorToolbar (header-right). Every section/slide change
// autosaves to homepage_drafts via the sections API; this bar surfaces the
// autosave status pill, Draft pending badge, Discard draft, Cancel (rolls draft
// back to session snapshot), Save as Draft (resnapshots so Cancel reverts here)
// and Update & Publish.
export default function HomepageFormFooter({ initialSummary, cancelHref, resnapshotAction }: Props) {
  const router = useRouter()
  const { showToast, showConfirm } = useToast()
  // The session opens only for the lock holder (or on an unclaimed draft, which claims it).
  const homepage = useHomepageLock()
  const edit = useEditSession({ resourceType: 'homepage', resourceId: homepage.lockId, lock: homepage.lock })
  const [summary, setSummary] = useState(initialSummary)
  const [autosave, setAutosave] = useState<AutosaveStatus>('idle')
  const [busy, setBusy] = useState<'publish' | 'discard' | 'draft' | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveBlockedRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/homepage-draft', { credentials: 'include', cache: 'no-store' })
      if (res.ok) setSummary(await res.json())
    } catch {}
  }, [])

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
      title: 'Discard the draft?',
      message: 'All unpublished homepage changes will be thrown away. The live homepage stays as it is.',
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
      window.location.reload()
    } catch {
      autosaveBlockedRef.current = false
      showToast('Failed to discard the draft', 'error')
      setBusy(null)
    }
  }

  async function handlePublish() {
    const ok = await showConfirm({
      title: 'Publish the homepage?',
      message: `Every draft change goes live at once${touched ? ` on the ${touched}` : ''}.`,
      confirmText: 'Publish',
      type: 'info',
    })
    if (!ok) return
    autosaveBlockedRef.current = true
    setBusy('publish')
    try {
      const res = await fetch('/api/admin/homepage-draft/publish', {
        method: 'POST',
        credentials: 'include',
        headers: homepage.headers(),
      })
      if (await homepage.locked(res)) {
        autosaveBlockedRef.current = false
        setBusy(null)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        autosaveBlockedRef.current = false
        showToast(data.error || 'Publish failed', 'error')
        setBusy(null)
        return
      }
      // Stay on the editor: close this session and start a new one so Cancel reverts to the published state.
      if (edit.sessionId) await edit.save()
      await edit.reopen()
      // Publish closed the lock and reopening took it again: pick up the new epoch before the next write.
      await homepage.lock?.refresh()
      await refresh()
      autosaveBlockedRef.current = false
      setBusy(null)
      showToast('Published - the homepage is live', 'success')
      router.refresh()
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
      await resnapshotAction()
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
          {busy === 'publish' ? 'Publishing...' : 'Update & Publish'}
        </FormButton>
      </RequireWrite>
    </FormFooter>
  )
}

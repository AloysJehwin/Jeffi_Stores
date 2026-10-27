'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Lock, Users } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { lockSummary, type DraftViewer, type UseDraftLockResult } from '@/hooks/useDraftLock'
import { timeAgo, type DraftLockView } from '@/lib/client/draft-lock-client'
import { badgeCls } from './tones'
import { Dialog } from './dialog'
import { FormButton, TextArea } from './form'

// Draft-lock chrome: who holds a draft, who is looking, and the lock actions. The lock fetches
// live in useDraftLock; these components only render and call its actions.

const ghost =
  'control-md inline-flex items-center border border-border-secondary bg-surface text-foreground-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const accent =
  'control-md inline-flex items-center border border-accent-500/40 bg-accent-500/10 text-accent-500 hover:bg-accent-500/20 font-semibold transition-colors disabled:opacity-50'

const initials = (n: string | null) =>
  (n ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase())
    .join('') || '?'

export function ViewerAvatars({ viewers }: { viewers: DraftViewer[] }) {
  if (!viewers.length) return null
  return (
    <span className="inline-flex items-center gap-1" title={viewers.map(v => `${v.name ?? 'Admin'} (${v.mode === 'edit' ? 'editing' : 'viewing'})`).join(', ')}>
      <Users className="h-3.5 w-3.5 text-foreground-muted" aria-hidden />
      <span className="flex -space-x-1.5">
        {viewers.slice(0, 4).map(v => (
          <span
            key={v.adminId}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-surface-elevated bg-surface-secondary text-[9px] font-semibold text-foreground-secondary"
          >
            {initials(v.name)}
          </span>
        ))}
      </span>
      {viewers.length > 4 && <span className="text-[11px] text-foreground-muted">+{viewers.length - 4}</span>}
    </span>
  )
}

/** "Priya editing" chip for list rows and view pages. */
export function DraftLockBadge({ lock, mine }: { lock: Pick<DraftLockView, 'ownerName' | 'ownerId' | 'lastActiveAt'> | null | undefined; mine?: boolean }) {
  if (!lock?.ownerId) return null
  return (
    <span className={`${badgeCls(mine ? 'blue' : 'amber')} inline-flex items-center gap-1`} title={`Last active ${timeAgo(lock.lastActiveAt)}`}>
      <Lock className="h-3 w-3" aria-hidden />
      {mine ? 'You' : (lock.ownerName ?? 'Another admin')}
    </span>
  )
}

/** Disables every control inside when someone else holds the draft. */
export function LockedFieldset({ readOnly, children, className = '' }: { readOnly: boolean; children: ReactNode; className?: string }) {
  return (
    <fieldset disabled={readOnly} aria-readonly={readOnly} className={`m-0 min-w-0 border-0 p-0 ${className}`}>
      {children}
    </fieldset>
  )
}

export function HandoverDialog({ lock, open, onClose }: { lock: UseDraftLockResult; open: boolean; onClose: () => void }) {
  const [list, setList] = useState<{ adminId: string; name: string }[] | null>(null)
  const [pick, setPick] = useState('')
  const { candidates } = lock
  useEffect(() => {
    if (!open) return
    setList(null)
    setPick('')
    void candidates().then(setList)
  }, [open, candidates])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Hand over draft"
      description="They become the editor; you keep read-only access."
      footer={
        <>
          <button type="button" className={ghost} onClick={onClose}>
            Cancel
          </button>
          <FormButton
            type="button"
            disabled={!pick || lock.busy}
            onClick={async () => {
              if (await lock.handover(pick)) onClose()
            }}
          >
            Hand over
          </FormButton>
        </>
      }
    >
      {list == null ? (
        <p className="text-sm text-foreground-muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-foreground-muted">No other active admin can edit this draft.</p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {list.map(c => (
            <label key={c.adminId} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-secondary">
              <input type="radio" name="handover-to" value={c.adminId} checked={pick === c.adminId} onChange={() => setPick(c.adminId)} />
              {c.name}
            </label>
          ))}
        </div>
      )}
    </Dialog>
  )
}

export function TakeoverDialog({ lock, open, onClose }: { lock: UseDraftLockResult; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (open) setReason('')
  }, [open])
  const ok = reason.trim().length >= 3
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Take over draft"
      description={`${lock.lock?.ownerName ?? 'The current editor'} loses edit access and is notified with your reason. Their unsaved changes are not kept.`}
      footer={
        <>
          <button type="button" className={ghost} onClick={onClose}>
            Cancel
          </button>
          <FormButton
            type="button"
            disabled={!ok || lock.busy}
            onClick={async () => {
              if (await lock.takeover(reason.trim())) onClose()
            }}
          >
            Take over
          </FormButton>
        </>
      }
    >
      <label className="mb-1.5 block text-xs font-medium text-foreground-secondary" htmlFor="takeover-reason">
        Reason <span className="text-red-500">*</span>
      </label>
      <TextArea id="takeover-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} autoFocus />
    </Dialog>
  )
}

/**
 * Lock state above an editor: holder, started / last active, live viewers, and the actions the
 * admin may take (Request access / Hand over / Release / Take over / Edit).
 */
export function DraftLockBanner({ lock, scope, className = '' }: { lock: UseDraftLockResult; scope: string; className?: string }) {
  const canWrite = useCanWrite(scope)
  const [dialog, setDialog] = useState<'handover' | 'takeover' | null>(null)
  if (!lock.loaded && !lock.unsaved) return null
  const l = lock.lock
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lock.unsaved ?? '')
      lock.setUnsaved(null)
    } catch {
      /* clipboard blocked */
    }
  }

  let tone = 'border-border-default bg-surface-elevated'
  let text: ReactNode = null
  const actions: ReactNode[] = []
  if (lock.isMine) {
    text = <span className="text-foreground-secondary">You are editing this draft</span>
    if (canWrite) {
      actions.push(
        <button key="handover" type="button" className={ghost} disabled={lock.busy} onClick={() => setDialog('handover')}>
          Hand over
        </button>,
        <button key="release" type="button" className={ghost} disabled={lock.busy} onClick={() => void lock.release()}>
          Release
        </button>
      )
    }
  } else if (lock.closed) {
    tone = 'border-blue-500/30 bg-blue-500/5'
    text = <span className="text-foreground-secondary">{lockSummary(l)}</span>
  } else if (l?.ownerId && !lock.claimable) {
    tone = 'border-amber-500/40 bg-amber-500/5'
    text = (
      <span className="text-foreground-secondary">
        <span className="font-semibold text-foreground">Read-only.</span> {lockSummary(l)} · active {timeAgo(l.lastActiveAt)}
        {l.via === 'takeover' && l.reason ? ` · taken over: ${l.reason}` : ''}
      </span>
    )
    if (canWrite) {
      actions.push(
        <button key="request" type="button" className={ghost} disabled={lock.busy} onClick={() => void lock.requestAccess()}>
          Request access
        </button>
      )
      if (lock.canTakeOver)
        actions.push(
          <button key="takeover" type="button" className={accent} disabled={lock.busy} onClick={() => setDialog('takeover')}>
            Take over
          </button>
        )
    }
  } else if (lock.claimable) {
    text = <span className="text-foreground-secondary">{l?.ownerId ? `${l.ownerName ?? 'The editor'} can no longer edit this draft.` : 'No one is editing this draft.'}</span>
    if (canWrite)
      actions.push(
        <button key="claim" type="button" className={accent} disabled={lock.busy} onClick={() => void lock.claim()}>
          Edit
        </button>
      )
  } else if (!lock.unsaved) {
    return null
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm ${tone} ${className}`} role="status">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Lock className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
        {text}
        <ViewerAvatars viewers={lock.viewers} />
        {lock.unsaved && (
          <span className="text-foreground-secondary">
            Your last unsaved changes weren&apos;t saved —{' '}
            <button type="button" className="font-semibold text-accent-500 underline" onClick={() => void copy()}>
              Copy them
            </button>
          </span>
        )}
      </div>
      {actions.length > 0 && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      <HandoverDialog lock={lock} open={dialog === 'handover'} onClose={() => setDialog(null)} />
      <TakeoverDialog lock={lock} open={dialog === 'takeover'} onClose={() => setDialog(null)} />
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeLockEvents } from '@/lib/client/admin-events-client'
import { setLockEpoch, timeAgo, type DraftLockState, type DraftLockView } from '@/lib/client/draft-lock-client'
import { useActionToast } from '@/components/admin/kit/toast'

export interface DraftViewer {
  adminId: string
  name: string | null
  mode: 'view' | 'edit'
  seenAt: string
}

export interface UseDraftLockOptions {
  resourceType: string
  resourceId: string | null | undefined
  /** Server-rendered state (getDraftLockState), so the first paint is already read-only when it should be. */
  initial?: DraftLockState | null
  /** Presence mode reported for this tab. */
  mode?: 'view' | 'edit'
  /** Called when the lock moves away from this admin (takeover, handover, publish elsewhere). */
  onLost?: (lock: DraftLockView | null) => void
}

export interface UseDraftLockResult {
  lock: DraftLockView | null
  loaded: boolean
  isMine: boolean
  /** Free to take: no holder, released, or the holder can no longer edit. */
  claimable: boolean
  readOnly: boolean
  closed: boolean
  viewers: DraftViewer[]
  epoch: number | null
  canTakeOver: boolean
  canDiscard: boolean
  busy: boolean
  /** Changes autosave could not write after the lock was lost (offered as "Copy them"). */
  unsaved: string | null
  setUnsaved: (v: string | null) => void
  refresh: () => Promise<void>
  /** An autosave/save got 423: drop to read-only now and re-read the lock. */
  markLocked: (unsaved?: unknown) => void
  claim: () => Promise<boolean>
  release: () => Promise<boolean>
  handover: (toAdminId: string) => Promise<boolean>
  takeover: (reason: string) => Promise<boolean>
  requestAccess: (message?: string) => Promise<boolean>
  candidates: () => Promise<{ adminId: string; name: string }[]>
}

const HEARTBEAT_MS = 20_000

function newTabId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

/** Per-admin draft lock for an editor: live holder, presence, and the lock actions. */
export function useDraftLock({ resourceType, resourceId, initial, mode = 'edit', onLost }: UseDraftLockOptions): UseDraftLockResult {
  const toast = useActionToast()
  const [state, setState] = useState<DraftLockState | null>(initial ?? null)
  const [viewers, setViewers] = useState<DraftViewer[]>([])
  const [busy, setBusy] = useState(false)
  const [unsaved, setUnsaved] = useState<string | null>(null)
  const tabId = useRef<string>('')
  if (!tabId.current) tabId.current = newTabId()
  const wasMine = useRef<boolean>(!!initial?.isMine)
  const [me, setMe] = useState<string | null>(null)
  const onLostRef = useRef(onLost)
  onLostRef.current = onLost
  const base = resourceId ? `/api/admin/draft-locks/${resourceType}/${resourceId}` : null

  const apply = useCallback(
    (next: DraftLockState & { viewers?: DraftViewer[]; me?: string }) => {
      if (next.me) setMe(next.me)
      setState({
        lock: next.lock,
        draftExists: next.draftExists,
        isMine: next.isMine,
        canEdit: next.canEdit,
        canTakeOver: next.canTakeOver,
        canDiscard: next.canDiscard,
      })
      if (next.viewers) setViewers(next.viewers)
      const l = next.lock
      if (wasMine.current && !next.isMine) {
        if (l?.closedAt) toast.info(`${l.closedByName ?? 'Someone'} ${l.closedReason ?? 'closed'} this draft`)
        else if (l?.via === 'takeover') toast.warning(`${l.ownerName ?? 'An owner'} took over this draft${l.reason ? `: ${l.reason}` : ''}`)
        else if (l?.via === 'handover' && l.ownerName) toast.info(`${l.ownerName} now holds this draft`)
        else toast.warning('You no longer hold this draft')
        onLostRef.current?.(l)
      }
      wasMine.current = next.isMine
      if (resourceId) setLockEpoch(resourceType, resourceId, next.isMine && l ? l.epoch : null)
    },
    [resourceId, resourceType, toast]
  )

  const refresh = useCallback(async () => {
    if (!base) return
    try {
      const r = await fetch(base, { cache: 'no-store' })
      if (r.ok) apply(await r.json())
    } catch {
      /* next heartbeat */
    }
  }, [base, apply])

  const beat = useCallback(
    async (leaving = false) => {
      if (!resourceId) return
      const body = JSON.stringify({ resourceType, resourceId, tabId: tabId.current, mode, leaving })
      if (leaving && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/admin/draft-locks/presence', body)
        return
      }
      try {
        const r = await fetch('/api/admin/draft-locks/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        if (r.ok && !leaving) apply(await r.json())
      } catch {
        /* offline */
      }
    },
    [resourceId, resourceType, mode, apply]
  )

  // Heartbeat doubles as the poll fallback when the event stream is down.
  useEffect(() => {
    if (!resourceId) return
    void beat()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void beat()
    }, HEARTBEAT_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void beat()
    }
    const onHide = () => void beat(true)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      void beat(true)
      setLockEpoch(resourceType, resourceId, null)
    }
  }, [resourceId, resourceType, beat])

  useEffect(() => {
    if (!resourceId) return
    return subscribeLockEvents(resourceType, resourceId, frame => {
      if (frame.type === 'presence') {
        if (frame.viewers) setViewers(frame.viewers as DraftViewer[])
        return
      }
      void refresh()
    })
  }, [resourceId, resourceType, refresh])

  const act = useCallback(
    async (payload: Record<string, unknown>, ok?: string): Promise<boolean> => {
      if (!base) return false
      setBusy(true)
      try {
        const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          toast.error(data.error || 'Could not update the draft lock')
          void refresh()
          return false
        }
        apply(data)
        if (ok) toast.success(ok)
        return true
      } catch {
        toast.error('Network error')
        return false
      } finally {
        setBusy(false)
      }
    },
    [base, apply, refresh, toast]
  )

  const lock = state?.lock ?? null
  const closed = !!lock?.closedAt
  const isMine = !!state?.isMine
  const claimable = !!state && !isMine && state.canEdit
  // Unloaded = optimistic (the server still enforces); loaded = read-only unless it is ours or free.
  const readOnly = !!resourceId && !!state && !isMine && !claimable

  const markLocked = useCallback(
    (lost?: unknown) => {
      if (lost !== undefined) {
        try {
          setUnsaved(typeof lost === 'string' ? lost : JSON.stringify(lost, null, 2))
        } catch {
          /* not serialisable */
        }
      }
      setState(s => (s ? { ...s, isMine: false, canEdit: false } : { lock: null, draftExists: true, isMine: false, canEdit: false, canTakeOver: false, canDiscard: false }))
      wasMine.current = false
      if (resourceId) setLockEpoch(resourceType, resourceId, null)
      void refresh()
    },
    [refresh, resourceId, resourceType]
  )

  return useMemo(
    () => ({
      lock,
      loaded: !!state,
      isMine,
      claimable,
      readOnly,
      closed,
      viewers: viewers.filter(v => v.adminId !== me),
      epoch: isMine && lock ? lock.epoch : null,
      canTakeOver: !!state?.canTakeOver,
      canDiscard: !!state?.canDiscard,
      busy,
      unsaved,
      setUnsaved,
      refresh,
      markLocked,
      claim: () => act({ action: 'claim' }),
      release: () => act({ action: 'release' }, 'Draft released'),
      handover: (toAdminId: string) => act({ action: 'handover', toAdminId }, 'Draft handed over'),
      takeover: (reason: string) => act({ action: 'takeover', reason }, 'You now hold this draft'),
      requestAccess: (message?: string) => act({ action: 'request_access', message }, `Asked ${lock?.ownerName ?? 'the holder'} for this draft`),
      candidates: async () => {
        if (!base) return []
        const r = await fetch(`${base}?candidates=1`, { cache: 'no-store' })
        const data = await r.json().catch(() => ({}))
        return Array.isArray(data.candidates) ? data.candidates : []
      },
    }),
    [lock, state, isMine, claimable, readOnly, closed, viewers, me, busy, unsaved, refresh, markLocked, act, base]
  )
}

export function lockSummary(lock: DraftLockView | null): string {
  if (!lock) return ''
  if (lock.closedAt) return `${lock.closedReason ?? 'Closed'} by ${lock.closedByName ?? 'someone'} · ${timeAgo(lock.closedAt)}`
  if (!lock.ownerId) return 'Unclaimed draft'
  return `Draft by ${lock.ownerName ?? 'another admin'} · started ${timeAgo(lock.startedAt)}`
}

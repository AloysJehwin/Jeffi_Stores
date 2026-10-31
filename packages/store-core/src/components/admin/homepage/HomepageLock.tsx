'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useDraftLock, type UseDraftLockResult } from '@/hooks/useDraftLock'
import { lockHeaders, type DraftLockState } from '@/lib/client/draft-lock-client'
import { DraftLockBanner } from '@/components/admin/kit'
import { HOMEPAGE_DRAFT_HEADER } from '@/lib/catalog/homepage-sections'

// The homepage draft being edited (each draft has its own lock), shared by the section manager,
// the hero editor and the footer. No draft = the live homepage, read-only. The lock fetches stay
// in useDraftLock.

const Ctx = createContext<{ lock: UseDraftLockResult; lockId: string | null } | null>(null)

export function HomepageLockProvider({ draftId, initial, children }: { draftId: string | null; initial?: DraftLockState | null; children: ReactNode }) {
  const lock = useDraftLock({ resourceType: 'homepage', resourceId: draftId, initial })
  const value = useMemo(() => ({ lock, lockId: draftId }), [lock, draftId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export interface HomepageLock {
  lock: UseDraftLockResult | null
  lockId: string | null
  /** No draft open, or someone else holds it. */
  readOnly: boolean
  /** Draft id + epoch headers for every draft write. */
  headers: () => Record<string, string>
  /** On a 423: toast, drop to read-only and return true. */
  locked: (res: Response) => Promise<boolean>
}

export function useHomepageLock(): HomepageLock {
  const ctx = useContext(Ctx)
  const { showToast } = useToast()
  const lock = ctx?.lock ?? null
  const lockId = ctx?.lockId ?? null
  const headers = useCallback(
    (): Record<string, string> => (lockId ? { ...lockHeaders('homepage', lockId), [HOMEPAGE_DRAFT_HEADER]: lockId } : {}),
    [lockId]
  )
  const locked = useCallback(
    async (res: Response) => {
      if (res.status !== 423) return false
      const body = await res.json().catch(() => ({}))
      showToast(body.error || 'Someone else is editing the homepage', 'error')
      lock?.markLocked()
      return true
    },
    [lock, showToast]
  )
  const readOnly = !!ctx && (!lockId || !!lock?.readOnly)
  return useMemo(() => ({ lock, lockId, readOnly, headers, locked }), [lock, lockId, readOnly, headers, locked])
}

/** Who holds the homepage draft, who is looking, and the lock actions. */
export function HomepageLockBanner() {
  const ctx = useContext(Ctx)
  return ctx?.lockId ? <DraftLockBanner lock={ctx.lock} scope="settings:write" /> : null
}

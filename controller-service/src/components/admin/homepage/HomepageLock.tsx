'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useDraftLock, type UseDraftLockResult } from '@/hooks/useDraftLock'
import { lockHeaders, type DraftLockState } from '@/lib/client/draft-lock-client'
import { DraftLockBanner } from '@/components/admin/kit'

// The homepage draft is a singleton with one lock, shared by the section manager, the hero
// editor and the footer. The lock fetches stay in useDraftLock.

const Ctx = createContext<{ lock: UseDraftLockResult; lockId: string } | null>(null)

export function HomepageLockProvider({ lockId, initial, children }: { lockId: string; initial?: DraftLockState | null; children: ReactNode }) {
  const lock = useDraftLock({ resourceType: 'homepage', resourceId: lockId, initial })
  const value = useMemo(() => ({ lock, lockId }), [lock, lockId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export interface HomepageLock {
  lock: UseDraftLockResult | null
  lockId: string | null
  /** Someone else holds the draft. */
  readOnly: boolean
  /** Epoch header for every draft write. */
  headers: () => Record<string, string>
  /** On a 423: toast, drop to read-only and return true. */
  locked: (res: Response) => Promise<boolean>
}

export function useHomepageLock(): HomepageLock {
  const ctx = useContext(Ctx)
  const { showToast } = useToast()
  const lock = ctx?.lock ?? null
  const lockId = ctx?.lockId ?? null
  const headers = useCallback(() => (lockId ? lockHeaders('homepage', lockId) : {}), [lockId])
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
  return useMemo(() => ({ lock, lockId, readOnly: !!lock?.readOnly, headers, locked }), [lock, lockId, headers, locked])
}

/** Who holds the homepage draft, who is looking, and the lock actions. */
export function HomepageLockBanner() {
  const ctx = useContext(Ctx)
  return ctx ? <DraftLockBanner lock={ctx.lock} scope="settings:write" /> : null
}

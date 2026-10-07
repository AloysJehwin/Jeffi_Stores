'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

// One shared copy of which products the signed-in customer has saved, so every heart on the page
// shows the real state and the header can show a count. Fetched once per sign-in, ids only.
export type WishlistToggle = 'added' | 'removed' | 'failed'

interface WishlistValue {
  ready: boolean
  count: number
  has: (productId: string) => boolean
  toggle: (productId: string) => Promise<WishlistToggle>
  remove: (productId: string) => Promise<boolean>
}

// Surfaces without the provider (the business portal) get a harmless no-op.
const NONE: WishlistValue = {
  ready: false,
  count: 0,
  has: () => false,
  toggle: async () => 'failed',
  remove: async () => false,
}

const WishlistContext = createContext<WishlistValue | null>(null)

async function addRemote(productId: string): Promise<boolean> {
  const res = await fetch('/api/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId }),
    credentials: 'include',
  })
  return res.ok
}

async function removeRemote(productId: string): Promise<boolean> {
  const res = await fetch(`/api/wishlist?productId=${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return res.ok
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  const [ready, setReady] = useState(false)
  const userId = user?.id ?? null

  useEffect(() => {
    let active = true
    setIds(new Set())
    setReady(false)
    if (!userId) return
    fetch('/api/wishlist?ids=1', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!active) return
        setIds(new Set<string>(Array.isArray(data?.productIds) ? data.productIds : []))
        setReady(true)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [userId])

  const setMember = useCallback((productId: string, member: boolean) => {
    setIds(prev => {
      if (prev.has(productId) === member) return prev
      const next = new Set(prev)
      if (member) next.add(productId)
      else next.delete(productId)
      return next
    })
  }, [])

  const toggle = useCallback(
    async (productId: string): Promise<WishlistToggle> => {
      const adding = !ids.has(productId)
      setMember(productId, adding) // optimistic; rolled back below on failure
      try {
        const ok = adding ? await addRemote(productId) : await removeRemote(productId)
        if (ok) return adding ? 'added' : 'removed'
      } catch {
        // fall through
      }
      setMember(productId, !adding)
      return 'failed'
    },
    [ids, setMember]
  )

  const remove = useCallback(
    async (productId: string): Promise<boolean> => {
      try {
        if (await removeRemote(productId)) {
          setMember(productId, false)
          return true
        }
      } catch {
        // fall through
      }
      return false
    },
    [setMember]
  )

  const value = useMemo<WishlistValue>(
    () => ({ ready, count: ids.size, has: (productId: string) => ids.has(productId), toggle, remove }),
    [ready, ids, toggle, remove]
  )

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}

export function useWishlist(): WishlistValue {
  return useContext(WishlistContext) ?? NONE
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson, type InfiniteControl } from '@/components/admin/kit/infinite'
import { subscribeAdminEvents } from '@/lib/client/admin-events-client'
import type { DraftLockView } from '@/lib/client/draft-lock-client'

export type DraftsScope = 'mine' | 'all' | 'unclaimed'

export interface DraftListItem {
  resourceType: string
  resourceId: string
  label: string
  editHref: string
  lock: DraftLockView | null
  updatedAt: string | null
  typeLabel: string
  writeScope: string
  viewers: number
  isMine: boolean
  canEdit: boolean
  canClaim: boolean
  canTakeOver: boolean
}

export interface DraftTypeOption {
  value: string
  label: string
}

interface ListResponse {
  items?: DraftListItem[]
  total?: number
  typeOptions?: DraftTypeOption[]
}

const POLL_MS = 30_000
const keyOf = (r: DraftListItem) => `${r.resourceType}:${r.resourceId}`

/**
 * One tab of the drafts dashboard (/api/admin/draft-locks). Lock events refresh it in place
 * (debounced, no skeleton); a 30 s poll covers a dropped event stream and viewer counts.
 */
export function useDraftsList(scope: DraftsScope, type: string, sort?: string | null, dir?: string) {
  const [rows, setRows] = useState<DraftListItem[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [types, setTypes] = useState<DraftTypeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pages = useRef(1)
  const seq = useRef(0)

  const fetchPage = useCallback(
    (page: number) => {
      const qs = new URLSearchParams({ scope, page: String(page) })
      if (type) qs.set('type', type)
      if (sort) {
        qs.set('sort', sort)
        qs.set('dir', dir ?? 'desc')
      }
      return fetchJson<ListResponse>(`/api/admin/draft-locks?${qs}`)
    },
    [scope, type, sort, dir]
  )

  /** Re-read the loaded pages. `silent` keeps the table on screen. */
  const refresh = useCallback(
    async (silent = true) => {
      const id = ++seq.current
      if (!silent) setLoading(true)
      try {
        const out: DraftListItem[] = []
        let last: ListResponse | null = null
        for (let p = 1; p <= pages.current; p++) {
          last = await fetchPage(p)
          out.push(...(last.items ?? []))
          if (out.length >= (last.total ?? 0)) break
        }
        if (id !== seq.current) return
        setRows(out)
        setTotal(last?.total ?? out.length)
        setTypes(last?.typeOptions ?? [])
        setError(null)
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (id === seq.current) setLoading(false)
      }
    },
    [fetchPage]
  )

  useEffect(() => {
    pages.current = 1
    setRows([])
    void refresh(false)
  }, [refresh])

  const loadMore = useCallback(async () => {
    const id = seq.current
    setLoadingMore(true)
    try {
      const r = await fetchPage(pages.current + 1)
      if (id !== seq.current) return
      pages.current += 1
      setRows(prev => {
        const seen = new Set(prev.map(keyOf))
        return [...prev, ...(r.items ?? []).filter(x => !seen.has(keyOf(x)))]
      })
      setTotal(r.total ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoadingMore(false)
    }
  }, [fetchPage])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const soon = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => void refresh(), 800)
    }
    const off = subscribeAdminEvents(f => {
      if (f.kind === 'lock' && f.type !== 'presence' && f.type !== 'request') soon()
    })
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => {
      off()
      clearInterval(poll)
      if (t) clearTimeout(t)
    }
  }, [refresh])

  const infinite: InfiniteControl = {
    total,
    hasMore: total != null && rows.length < total,
    loadingMore,
    error,
    loadMore: () => void loadMore(),
    retry: () => void refresh(false),
  }
  return { rows, types, loading, refresh, infinite }
}

export type DraftCounts = Record<DraftsScope, number>

/** Drafts of one type per tab, kept current like the list (lock events + poll). */
export function useDraftCounts(type: string) {
  const [counts, setCounts] = useState<DraftCounts | null>(null)
  const refresh = useCallback(async () => {
    try {
      const scopes: DraftsScope[] = ['mine', 'all', 'unclaimed']
      const res = await Promise.all(scopes.map(s => fetchJson<ListResponse>(`/api/admin/draft-locks?scope=${s}&type=${encodeURIComponent(type)}`)))
      setCounts({ mine: res[0].total ?? 0, all: res[1].total ?? 0, unclaimed: res[2].total ?? 0 })
    } catch {
      setCounts(c => c ?? { mine: 0, all: 0, unclaimed: 0 })
    }
  }, [type])

  useEffect(() => {
    void refresh()
    let t: ReturnType<typeof setTimeout> | null = null
    const off = subscribeAdminEvents(f => {
      if (f.kind !== 'lock' || f.type === 'presence' || f.type === 'request') return
      if (t) clearTimeout(t)
      t = setTimeout(() => void refresh(), 800)
    })
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => {
      off()
      clearInterval(poll)
      if (t) clearTimeout(t)
    }
  }, [refresh])

  return { counts, refresh }
}

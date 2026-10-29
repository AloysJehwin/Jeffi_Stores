'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentChanges } from '@/lib/client/agent-events'
import type { ChangeItem, ChangeLogPage } from '@/lib/admin/change-log'

export interface ChangeLogState {
  items: ChangeItem[]
  loading: boolean
  error: boolean
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
  reload: () => void
}

/** A record's change log. `version` (the record's updated_at) refetches it after the page changes it. */
export function useChangeLog(
  kind: string,
  id: string,
  { fields, version, limit = 30, enabled = true }: { fields?: string[]; version?: unknown; limit?: number; enabled?: boolean } = {}
): ChangeLogState {
  const [items, setItems] = useState<ChangeItem[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const seq = useRef(0)
  const fieldsKey = fields?.join(',') ?? ''

  const fetchPage = useCallback(
    async (before?: string): Promise<ChangeLogPage> => {
      const qs = new URLSearchParams({ kind, id, limit: String(limit) })
      if (fieldsKey) qs.set('fields', fieldsKey)
      if (before) qs.set('before', before)
      const res = await fetch(`/api/admin/change-log?${qs}`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
    [kind, id, limit, fieldsKey]
  )

  const reload = useCallback(() => {
    const n = ++seq.current
    setLoading(true)
    setError(false)
    fetchPage()
      .then(page => {
        if (n !== seq.current) return
        setItems(page.items)
        setNext(page.next)
      })
      .catch(() => n === seq.current && setError(true))
      .finally(() => n === seq.current && setLoading(false))
  }, [fetchPage])

  useEffect(() => {
    if (enabled) reload()
  }, [enabled, reload, version])

  useAgentChanges(() => enabled && reload())

  const loadMore = useCallback(() => {
    if (!next || loadingMore) return
    const n = seq.current
    setLoadingMore(true)
    fetchPage(next)
      .then(page => {
        if (n !== seq.current) return
        setItems(prev => [...prev, ...page.items.filter(i => !prev.some(p => p.id === i.id))])
        setNext(page.next)
      })
      .catch(() => n === seq.current && setError(true))
      .finally(() => setLoadingMore(false))
  }, [next, loadingMore, fetchPage])

  return { items, loading, error, hasMore: !!next, loadingMore, loadMore, reload }
}

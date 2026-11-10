'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useAgentChanges } from '@/lib/client/agent-events'
import type { PageResult } from './infinite'

// Lists inside a page (a section, card or tab with more content below it) show a fixed number of
// rows with ‹ › arrows instead of scrolling on forever. The page's own main list keeps infinite scroll.

export const EMBEDDED_PAGE_SIZE = 10

export interface PagerControl {
  /** 1-based. */
  page: number
  pageSize: number
  /** Rows in total, when known. */
  total: number | null
  hasNext: boolean
  /** A page is being fetched (the current rows stay on screen). */
  loading: boolean
  error?: string | null
  setPage: (page: number) => void
  retry?: () => void
}

/** "11–20 of 240 orders" with previous and next arrows. Hidden when everything fits on one page. */
export function Pager({ control, noun = 'rows', className = '' }: { control: PagerControl; noun?: string; className?: string }) {
  const { page, pageSize, total, hasNext, loading, error, setPage, retry } = control
  if (page <= 1 && !hasNext && !error) return null
  const from = (page - 1) * pageSize + 1
  const to = total != null ? Math.min(page * pageSize, total) : page * pageSize
  const btn =
    'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-default text-foreground-secondary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-40'
  return (
    // Arrows stay clear of the assistant's floating button (--dock-offset) when the list ends the page.
    <div className={`flex flex-wrap items-center justify-between gap-2 pl-1 pr-[calc(0.25rem+var(--dock-offset,0px))] pt-3 text-xs text-foreground-muted ${className}`}>
      {error ? (
        <span role="alert" className="flex items-center gap-2 text-red-600 dark:text-red-400">
          {error}
          <button type="button" onClick={retry ?? (() => setPage(page))} className="control-xs border border-red-500/40 hover:bg-red-500/10">
            Retry
          </button>
        </span>
      ) : (
        <span className="tabular-nums" aria-live="polite">
          <span className="font-medium text-foreground">
            {from}–{to}
          </span>
          {total != null && (
            <>
              {' '}
              of <span className="font-medium text-foreground">{total}</span>
            </>
          )}{' '}
          {noun}
        </span>
      )}
      <span className="flex items-center gap-1.5">
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading" />}
        <button type="button" className={btn} onClick={() => setPage(page - 1)} disabled={page <= 1 || loading} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" className={btn} onClick={() => setPage(page + 1)} disabled={!hasNext || loading} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </span>
    </div>
  )
}

/** Rows already in memory, one page at a time; back to page 1 when resetKey changes. */
export function usePagedRows<T>(rows: T[], pageSize = EMBEDDED_PAGE_SIZE, resetKey: unknown = null): { shown: T[]; pager: PagerControl } {
  const [page, setPageState] = useState(1)
  const [prevKey, setPrevKey] = useState(resetKey)
  if (prevKey !== resetKey) {
    setPrevKey(resetKey)
    setPageState(1)
  }
  const last = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, last)
  const setPage = useCallback((p: number) => setPageState(Math.max(1, p)), [])
  return {
    shown: rows.slice((current - 1) * pageSize, current * pageSize),
    pager: { page: current, pageSize, total: rows.length, hasNext: current < last, loading: false, setPage },
  }
}

export interface PagedList<T> {
  /** The current page's rows only. */
  rows: T[]
  /** First page in flight (show the skeleton); later pages keep the current rows on screen. */
  loading: boolean
  error: string | null
  pager: PagerControl
  reload: () => void
  setRows: (fn: (rows: T[]) => T[]) => void
}

/**
 * Fetches one page from an API and replaces the rows with it: the arrows load the next or previous
 * page, never both. `key` change (filters, tab, search) starts again at page 1; key = null pauses.
 */
export function usePagedList<T>({ key, pageSize = EMBEDDED_PAGE_SIZE, fetchPage }: { key: string | null; pageSize?: number; fetchPage: (page: number, signal: AbortSignal) => Promise<PageResult<T>> }): PagedList<T> {
  const [rows, setRowsState] = useState<T[]>([])
  const [page, setPageState] = useState(1)
  const [total, setTotal] = useState<number | null>(null)
  const [hasNext, setHasNext] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(key != null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage

  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    setPageState(1)
    setLoaded(false)
  }

  useEffect(() => {
    if (key == null) {
      setBusy(false)
      return
    }
    const c = new AbortController()
    setBusy(true)
    setError(null)
    fetchRef
      .current(page, c.signal)
      .then(res => {
        if (c.signal.aborted) return
        const t = res.total ?? null
        // A page emptied by a delete or a narrower filter steps back to the last one with rows.
        if (!res.rows.length && page > 1) {
          setPageState(p => Math.max(1, p - 1))
          return
        }
        setRowsState(res.rows)
        setTotal(t)
        setHasNext(res.hasMore ?? (t != null ? page * pageSize < t : res.rows.length >= pageSize))
        setLoaded(true)
      })
      .catch(e => {
        if (c.signal.aborted) return
        setError(e instanceof Error && e.message ? e.message : 'Failed to load')
        setLoaded(true)
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false)
      })
    return () => c.abort()
  }, [key, page, nonce, pageSize])

  const setPage = useCallback((p: number) => setPageState(Math.max(1, p)), [])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  useAgentChanges(reload)
  const setRows = useCallback((fn: (r: T[]) => T[]) => setRowsState(fn), [])

  return {
    rows,
    loading: busy && !loaded,
    error: loaded && !rows.length ? error : null,
    reload,
    setRows,
    pager: { page, pageSize, total, hasNext, loading: busy && loaded, error: rows.length ? error : null, setPage, retry: reload },
  }
}

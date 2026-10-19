'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// Infinite lists. Three sources, one footer:
// - useInfiniteList: client fetch of page N from an API (page/limit or offset), appended on scroll.
// - useServerPages: a server page renders ?page=N; rows accumulate client-side while the URL is
//   replaced with page+1. A fresh load with page>1 is replaced back to page 1 (no burst of N loads).
// - useReveal: data that is already in memory (report payloads); shows it pageSize rows at a time.

export interface InfiniteControl {
  total?: number | null
  hasMore: boolean
  loadingMore: boolean
  error?: string | null
  loadMore: () => void
  retry?: () => void
}

/** Sentinel + "Load more" fallback + "Showing X of Y", loading and error rows. */
export function InfiniteFooter({ shown, control, noun = 'rows', className = '' }: { shown: number; control: InfiniteControl; noun?: string; className?: string }) {
  const { total, hasMore, loadingMore, error, loadMore, retry } = control
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore])
  // Re-fires while the sentinel stays on screen, so short pages chain until the viewport fills.
  useEffect(() => {
    if (visible && hasMore && !loadingMore && !error) loadMore()
  }, [visible, hasMore, loadingMore, error, loadMore])

  if (!shown && !hasMore && !error) return null
  const of = total != null && total >= shown ? total : null
  return (
    <div className={`px-1 pt-3 text-xs text-foreground-muted ${className}`}>
      {error ? (
        <div role="alert" className="flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-red-600 dark:text-red-400">
          <span>{error}</span>
          <button type="button" onClick={retry ?? loadMore} className="control-xs border border-red-500/40 hover:bg-red-500/10">
            Retry
          </button>
        </div>
      ) : loadingMore ? (
        <div className="flex items-center justify-center gap-2 py-2" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading more...
        </div>
      ) : hasMore ? (
        <div className="flex justify-center py-1">
          <button type="button" onClick={loadMore} className="control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary">
            Load more
          </button>
        </div>
      ) : null}
      <div ref={ref} aria-hidden className="h-px" />
      {shown > 0 && (
        <p className="pt-1 text-center tabular-nums">
          Showing <span className="font-medium text-foreground">{shown}</span>
          {of != null && (
            <>
              {' '}
              of <span className="font-medium text-foreground">{of}</span>
            </>
          )}{' '}
          {noun}
        </p>
      )}
    </div>
  )
}

export interface PageResult<T> {
  rows: T[]
  total?: number | null
  hasMore?: boolean
}

export interface InfiniteList<T> extends InfiniteControl {
  rows: T[]
  /** First page in flight (show the list skeleton). */
  loading: boolean
  setRows: (fn: (rows: T[]) => T[]) => void
  /** Start again from page 1 (after a mutation or an explicit refresh). */
  reload: () => void
}

/**
 * Fetches page 1 when `key` changes (filters, search, tab) and appends the next page on demand.
 * `fetchPage` gets a 1-based page; derive offset as (page - 1) * pageSize when the API wants one.
 * key = null pauses loading.
 */
export function useInfiniteList<T>({ key, pageSize, fetchPage, getKey }: { key: string | null; pageSize: number; fetchPage: (page: number, signal: AbortSignal) => Promise<PageResult<T>>; getKey?: (r: T) => string | number }): InfiniteList<T> {
  const [rows, setRowsState] = useState<T[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(key != null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const keyRef = useRef(getKey)
  keyRef.current = getKey
  const pageRef = useRef(0)
  const busy = useRef(false)
  const ctl = useRef<AbortController | null>(null)

  const run = useCallback(
    async (page: number) => {
      ctl.current?.abort()
      const c = new AbortController()
      ctl.current = c
      busy.current = true
      setError(null)
      if (page === 1) setLoading(true)
      else setLoadingMore(true)
      try {
        const res = await fetchRef.current(page, c.signal)
        if (c.signal.aborted) return
        pageRef.current = page
        const gk = keyRef.current
        setRowsState(prev => {
          if (page === 1) return res.rows
          if (!gk) return [...prev, ...res.rows]
          const seen = new Set(prev.map(gk))
          return [...prev, ...res.rows.filter(r => !seen.has(gk(r)))]
        })
        const t = res.total ?? null
        setTotal(t)
        setHasMore(res.hasMore ?? (t != null ? (page - 1) * pageSize + res.rows.length < t : res.rows.length >= pageSize))
      } catch (e) {
        if (c.signal.aborted) return
        setError(e instanceof Error && e.message ? e.message : 'Failed to load')
        if (page === 1) setRowsState([])
      } finally {
        if (!c.signal.aborted) {
          busy.current = false
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [pageSize]
  )

  useEffect(() => {
    if (key == null) {
      ctl.current?.abort()
      setLoading(false)
      return
    }
    pageRef.current = 0
    void run(1)
    return () => ctl.current?.abort()
  }, [key, nonce, run])

  const loadMore = useCallback(() => {
    if (busy.current || key == null) return
    void run(pageRef.current + 1)
  }, [run, key])
  const retry = useCallback(() => {
    if (key == null) return
    void run(pageRef.current + 1 || 1)
  }, [run, key])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  const setRows = useCallback((fn: (r: T[]) => T[]) => setRowsState(fn), [])

  return { rows, total, hasMore: hasMore && !loading, loading, loadingMore, error, loadMore, retry, reload, setRows }
}

/** Throws on a non-2xx JSON response so useInfiniteList shows the Retry row. */
export async function fetchJson<J = any>(url: string, signal?: AbortSignal, init?: RequestInit): Promise<J> {
  const res = await fetch(url, { credentials: 'include', ...init, signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`)
  return data as J
}

/** In-memory data shown pageSize rows at a time; resets when resetKey changes. */
export function useReveal<T>(rows: T[], pageSize: number, resetKey: unknown = null): { shown: T[]; control: InfiniteControl } {
  const [count, setCount] = useState(pageSize)
  const [prevKey, setPrevKey] = useState(resetKey)
  if (prevKey !== resetKey) {
    setPrevKey(resetKey)
    setCount(pageSize)
  }
  const loadMore = useCallback(() => setCount(c => c + pageSize), [pageSize])
  return { shown: rows.slice(0, count), control: { total: rows.length, hasMore: count < rows.length, loadingMore: false, loadMore } }
}

function withoutPage(sp: URLSearchParams | { toString(): string }, param: string) {
  const q = new URLSearchParams(sp.toString())
  q.delete(param)
  q.sort()
  return q.toString()
}

/** First scrollable ancestor (admin shell's <main>, else the document scroller). SSR-safe. */
function findScrollParent(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  // AdminShell wraps the pane in <main class="... overflow-y-auto">; use it when present.
  const main = document.querySelector('main') as HTMLElement | null
  if (main) {
    const ov = getComputedStyle(main).overflowY
    if (ov === 'auto' || ov === 'scroll') return main
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

/**
 * Server-rendered pages (?page=N) accumulated client-side. Advancing replaces the URL with page+1
 * (scroll: false, no history entry) and appends the rows the server renders for it. Any other
 * param change starts over. A fresh mount with page>1 (refresh, back) is replaced to page 1, so
 * the list is always complete from the top without fetching pages 1..N at once.
 */
export function useServerPages<T>({ rows, page, total, rowKey, pageHref, param = 'page' }: { rows: T[]; page: number; total: number; rowKey: (r: T) => string; pageHref?: (p: number) => string; param?: string }): { rows: T[]; resetting: boolean; control: InfiniteControl } {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const key = withoutPage(sp, param)
  const [pending, startTransition] = useTransition()
  const store = useRef<{ key: string; pages: Map<number, T[]> } | null>(null)
  // Where the scroll was when load-more started; restored below.
  const scrollSnap = useRef<{ el: HTMLElement; top: number; page: number } | null>(null)

  let s = store.current
  if (!s || s.key !== key) {
    s = { key, pages: new Map() }
    store.current = s
  }
  const resetting = page > 1 && !s.pages.has(1)
  if (!resetting) {
    s.pages.set(page, rows)
    for (const p of [...s.pages.keys()]) if (p > page) s.pages.delete(p)
  }

  const href = useCallback(
    (p: number) => {
      if (pageHref) return pageHref(p)
      const q = new URLSearchParams(sp.toString())
      if (p > 1) q.set(param, String(p))
      else q.delete(param)
      const qs = q.toString()
      return `${pathname}${qs ? `?${qs}` : ''}`
    },
    [pageHref, sp, param, pathname]
  )

  // One replace per target: href changes identity every render when pageHref is inline.
  const requested = useRef<string | null>(null)
  useEffect(() => {
    if (!resetting) return
    const target = `${key}#1`
    if (requested.current === target) return
    requested.current = target
    router.replace(href(1), { scroll: false })
  }, [resetting, router, href, key])

  const merged: T[] = []
  if (!resetting) {
    const seen = new Set<string>()
    for (let p = 1; p <= page; p++) {
      for (const r of s.pages.get(p) ?? []) {
        const k = rowKey(r)
        if (seen.has(k)) continue
        seen.add(k)
        merged.push(r)
      }
    }
  }
  const hasMore = !resetting && rows.length > 0 && merged.length < total
  useEffect(() => {
    if (!pending && requested.current && !requested.current.endsWith('#1')) requested.current = null
  }, [pending, page])
  // Put the scroll back where load-more left it. In production Next reuses the route's param-less
  // prefetch for ?page=N and then ignores `scroll: false`: it scrolls the page to the top from a
  // parent layout effect, on the commit that shows the route's loading skeleton or on the one that
  // brings the rows back. So after each commit check from the next frame (before paint) and keep
  // checking while the rows stream in, a few frames more once the page has advanced. Gives up if the
  // user has scrolled themselves.
  useLayoutEffect(() => {
    const snap = scrollSnap.current
    if (!snap || pending) return
    const { el, top } = snap
    const landed = page >= snap.page
    let frames = 0
    let raf = 0
    const put = () => {
      const y = el.scrollTop
      if (y < top - 2 && y <= top / 2 && el.scrollHeight - el.clientHeight >= top) el.scrollTop = top
      if (++frames < (landed ? 12 : 300)) raf = requestAnimationFrame(put)
      else if (landed && scrollSnap.current === snap) scrollSnap.current = null
    }
    raf = requestAnimationFrame(put)
    return () => cancelAnimationFrame(raf)
  }, [page, pending])
  // Filter/search change (key change) invalidates the snapshot — don't restore to a stale offset.
  useEffect(() => {
    scrollSnap.current = null
  }, [key])
  const loadMore = useCallback(() => {
    if (pending || !hasMore) return
    const target = `${key}#${page + 1}`
    if (requested.current === target) return
    requested.current = target
    // A page that chains straight after the last one can start while Next has just scrolled to the
    // top and the restore below hasn't run yet: keep the higher of the two positions.
    const el = findScrollParent()
    const prev = scrollSnap.current
    if (el) scrollSnap.current = { el, top: Math.max(el.scrollTop, prev?.el === el ? prev.top : 0), page: page + 1 }
    startTransition(() => router.replace(href(page + 1), { scroll: false }))
  }, [pending, hasMore, router, href, page, key])

  return { rows: merged, resetting, control: { total, hasMore, loadingMore: pending, loadMore } }
}

/**
 * Server components with ?page lists of rendered nodes (no row data on the client): pass this
 * page's rendered items; earlier pages are kept and the footer advances the URL.
 */
export function ServerPagedItems({ items, page, total, noun, wrap, param, wrapClassName, footerClassName }: { items: { key: string; node: ReactNode }[]; page: number; total: number; noun?: string; wrap?: 'tbody' | 'div' | 'ul'; param?: string; wrapClassName?: string; footerClassName?: string }) {
  const { rows, resetting, control } = useServerPages({ rows: items, page, total, rowKey: i => i.key, param })
  if (resetting) return null
  const nodes = rows.map(i => <FragmentKey key={i.key}>{i.node}</FragmentKey>)
  return (
    <>
      {wrap === 'tbody' ? <tbody className={wrapClassName}>{nodes}</tbody> : wrap === 'ul' ? <ul className={wrapClassName}>{nodes}</ul> : <div className={wrapClassName}>{nodes}</div>}
      <InfiniteFooterOutsideTable wrap={wrap} shown={rows.length} control={control} noun={noun} className={footerClassName} />
    </>
  )
}

function FragmentKey({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function InfiniteFooterOutsideTable({ wrap, className, ...p }: { wrap?: string; className?: string; shown: number; control: InfiniteControl; noun?: string }) {
  if (wrap === 'tbody')
    return (
      <tfoot>
        <tr>
          <td colSpan={100}>
            <InfiniteFooter {...p} className={className ?? 'pb-3'} />
          </td>
        </tr>
      </tfoot>
    )
  return <InfiniteFooter {...p} className={className} />
}

'use client'

import { memo, startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAgentChanges } from '@/lib/client/agent-events'

// Infinite lists. Three sources, one footer:
// - useInfiniteList: client fetch of page N from an API (page/limit or offset), appended on scroll.
// - useServerPages: a server-rendered page plus later pages from a server action, appended on scroll;
//   the URL never carries the scroll position.
// - useReveal: data that is already in memory (report payloads); shows it pageSize rows at a time.

export interface InfiniteControl {
  total?: number | null
  hasMore: boolean
  loadingMore: boolean
  error?: string | null
  loadMore: () => void
  retry?: () => void
  /** The next page as a plain link (crawlers, open in a new tab); a click still loads in place. */
  href?: string
  /** false: only the footer's link or button loads more, never the sentinel. */
  auto?: boolean
}

/** Nearest ancestor that scrolls vertically (the admin shell's <main>); null = the viewport. */
function scrollRoot(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const ov = getComputedStyle(p).overflowY
    if ((ov === 'auto' || ov === 'scroll') && (p.scrollHeight > p.clientHeight + 1 || p.tagName === 'MAIN')) return p
  }
  return null
}

const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

/** Sentinel + "Load more" fallback + "Showing X of Y", loading and error rows. */
export function InfiniteFooter({ shown, control, noun = 'rows', className = '' }: { shown: number; control: InfiniteControl; noun?: string; className?: string }) {
  const { total, hasMore, loadingMore, error, loadMore, retry, href, auto = true } = control
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  // Observed against the list's own scroller: against the viewport, a scrolling <main> clips the
  // margin away and the next page only starts once the sentinel is on screen. Three screens ahead, so
  // the rows are in before the reader gets there.
  useEffect(() => {
    const el = ref.current
    if (!el || !auto || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root: scrollRoot(el), rootMargin: '0px 0px 300% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, auto])
  // Re-fires while the sentinel stays in range, so short pages chain until the margin fills.
  useEffect(() => {
    if (auto && visible && hasMore && !loadingMore && !error) loadMore()
  }, [auto, visible, hasMore, loadingMore, error, loadMore])

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
          {href ? (
            <a
              href={href}
              rel="next"
              onClick={e => {
                if (!plainClick(e)) return
                e.preventDefault()
                loadMore()
              }}
              className="control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary"
            >
              Load more
            </a>
          ) : (
            <button type="button" onClick={loadMore} className="control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary">
              Load more
            </button>
          )}
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
  useAgentChanges(reload)
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

/** A server action that returns one more page: `page` is 1-based, rows as the server page renders them. */
export type LoadPage<T> = (page: number) => Promise<PageResult<T> | T[]>

const LAZY = Symbol.for('react.lazy')
const ELEMENTS = [Symbol.for('react.transitional.element'), Symbol.for('react.element')]

// JSX from a server action arrives as lazy references to rows that may still be streaming in. Resolve
// them before rendering: an append that suspends on one can be left waiting on a wake-up that never
// comes (seen with Next 15.5's React canary), which blocks every later transition too.
function pendingLazies(v: unknown, seen: Set<object>, out: Promise<unknown>[], depth = 0): void {
  if (!v || typeof v !== 'object' || seen.has(v) || depth > 40) return
  seen.add(v)
  const o = v as { $$typeof?: symbol; _init?: (p: unknown) => unknown; _payload?: unknown; type?: unknown; props?: unknown; [k: string]: unknown }
  if (o.$$typeof === LAZY && typeof o._init === 'function') {
    try {
      pendingLazies(o._init(o._payload), seen, out, depth + 1)
    } catch (e) {
      if (e && typeof (e as PromiseLike<unknown>).then === 'function') out.push(new Promise(r => (e as PromiseLike<unknown>).then(r, r)))
    }
    return
  }
  if (Array.isArray(v)) for (const x of v) pendingLazies(x, seen, out, depth + 1)
  else if (o.$$typeof && ELEMENTS.includes(o.$$typeof)) {
    pendingLazies(o.type, seen, out, depth + 1)
    pendingLazies(o.props, seen, out, depth + 1)
  } else if (Object.getPrototypeOf(v) === Object.prototype) for (const k in o) pendingLazies(o[k], seen, out, depth + 1)
}

async function settle(v: unknown): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const out: Promise<unknown>[] = []
    pendingLazies(v, new Set(), out)
    if (!out.length) return
    await Promise.all(out)
  }
}

type Pages<T> = { key: string; start: number; more: T[][]; total: number | null; done: boolean; loading: boolean; error: string | null }
const freshPages = <T,>(key: string, start: number): Pages<T> => ({ key, start, more: [], total: null, done: false, loading: false, error: null })

/**
 * A server page (?page=N, page 1 without it) plus the pages after it, fetched with `loadPage` and
 * appended client-side. The URL is never touched while scrolling: no navigation, no re-render of the
 * route, and a ?page=N link (old bookmark, crawler) still renders that page and continues from it.
 * Any other param change starts over. `isExtra` marks rows that aren't part of the paged total
 * (a promo or section between products). Without `loadPage` the footer links to the next page.
 */
export function useServerPages<T>({ rows, page, total, rowKey, pageHref, param = 'page', isExtra, loadPage, pageSize }: { rows: T[]; page: number; total: number; rowKey: (r: T) => string; pageHref?: (p: number) => string; param?: string; isExtra?: (r: T) => boolean; loadPage?: LoadPage<T>; pageSize?: number }): { rows: T[]; shown: number; control: InfiniteControl } {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const key = withoutPage(sp, param)
  const [state, setState] = useState<Pages<T>>(() => freshPages(key, page))
  let s = state
  if (s.key !== key || s.start !== page) {
    s = freshPages(key, page)
    setState(s)
  }

  const merged: T[] = []
  const seen = new Set<string>()
  for (const list of [rows, ...s.more]) {
    for (const r of list) {
      const k = rowKey(r)
      if (seen.has(k)) continue
      seen.add(k)
      merged.push(r)
    }
  }
  const count = (list: T[]) => (isExtra ? list.filter(r => !isExtra(r)).length : list.length)
  const shown = count(merged)
  const firstCount = count(rows)
  const tot = s.total ?? total
  const hasMore = !s.done && firstCount > 0 && (s.start - 1) * (pageSize ?? firstCount) + shown < tot
  const next = s.start + 1 + s.more.length

  const href = (p: number) => {
    if (pageHref) return pageHref(p)
    const q = new URLSearchParams(sp.toString())
    if (p > 1) q.set(param, String(p))
    else q.delete(param)
    const qs = q.toString()
    return `${pathname}${qs ? `?${qs}` : ''}`
  }
  const nextHref = hasMore ? href(next) : undefined

  const live = useRef({ s, hasMore, next, loadPage, nextHref })
  live.current = { s, hasMore, next, loadPage, nextHref }
  const inflight = useRef<string | null>(null)
  const loadMore = useCallback(() => {
    const { s, hasMore, next, loadPage, nextHref } = live.current
    if (!hasMore) return
    if (!loadPage) {
      if (nextHref) router.push(nextHref)
      return
    }
    const tag = `${s.key}#${s.start}#${next}`
    if (inflight.current === tag) return
    inflight.current = tag
    const mine = (x: Pages<T>) => x.key === s.key && x.start === s.start && x.start + 1 + x.more.length === next
    setState(x => (mine(x) ? { ...x, loading: true, error: null } : x))
    loadPage(next)
      .then(async res => {
        const r = Array.isArray(res) ? { rows: res, total: null } : res
        await settle(r.rows)
        if (inflight.current === tag) inflight.current = null
        // A transition: the new rows render in slices, so scrolling never waits on a long commit.
        startTransition(() => setState(x => (mine(x) ? { ...x, loading: false, more: [...x.more, r.rows], total: r.total ?? x.total, done: r.rows.length === 0 } : x)))
      })
      .catch(e => {
        if (inflight.current === tag) inflight.current = null
        setState(x => (mine(x) ? { ...x, loading: false, error: e instanceof Error && e.message ? e.message : 'Failed to load' } : x))
      })
  }, [router])

  return { rows: merged, shown, control: { total: tot, hasMore, loadingMore: s.loading, error: s.error, loadMore, retry: loadMore, href: nextHref, auto: !!loadPage } }
}

export interface PagedNode {
  key: string
  node: ReactNode
  /** Not counted in the paged total (a section between products). */
  extra?: boolean
}

/**
 * Server-rendered nodes (no row data on the client): pass this page's items and a `loadPage`
 * server action that renders the items of any other page; they are appended on scroll.
 */
export function ServerPagedItems({ items, page, total, noun, wrap, param, wrapClassName, footerClassName, loadPage, pageSize }: { items: PagedNode[]; page: number; total: number; noun?: string; wrap?: 'tbody' | 'div' | 'ul'; param?: string; wrapClassName?: string; footerClassName?: string; loadPage?: LoadPage<PagedNode>; pageSize?: number }) {
  const { rows, shown, control } = useServerPages({ rows: items, page, total, rowKey: i => i.key, param, isExtra: i => !!i.extra, loadPage, pageSize })
  const nodes = rows.map(i => <ItemNode key={i.key} node={i.node} />)
  return (
    <>
      {wrap === 'tbody' ? <tbody className={wrapClassName}>{nodes}</tbody> : wrap === 'ul' ? <ul className={wrapClassName}>{nodes}</ul> : <div className={wrapClassName}>{nodes}</div>}
      <InfiniteFooterOutsideTable wrap={wrap} shown={shown} control={control} noun={noun} className={footerClassName} />
    </>
  )
}

// Each node keeps its identity across appends, so earlier items never re-render.
const ItemNode = memo(function ItemNode({ node }: { node: ReactNode }) {
  return <>{node}</>
})

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

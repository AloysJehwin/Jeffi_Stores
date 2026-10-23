'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PAGE_CLS, pageWindow } from './Pagination'

/** Client pager. With `total` it shows numbered pages; without (cursor APIs) just page N + prev/next. */
export default function Pager({ page, onPage, total, pageSize = 20, hasNext }: {
  page: number; onPage: (p: number) => void; total?: number; pageSize?: number; hasNext?: boolean
}) {
  const pages = total != null ? Math.ceil(total / pageSize) : null
  const canNext = pages != null ? page < pages : !!hasNext
  if ((pages ?? (hasNext || page > 1 ? 2 : 1)) <= 1) return null
  return (
    <nav className={PAGE_CLS.wrap} aria-label="Pagination">
      <span className={PAGE_CLS.info}>
        {total != null ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString('en-IN')}` : `Page ${page}`}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={page <= 1 ? PAGE_CLS.disabled : PAGE_CLS.btn}><ChevronLeft className="w-4 h-4" /></button>
        {pages != null && pageWindow(page, pages).map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} className="px-1 text-foreground-muted">…</span>
            : <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined} className={p === page ? PAGE_CLS.active : PAGE_CLS.btn}>{p}</button>
        )}
        <button type="button" onClick={() => onPage(page + 1)} disabled={!canNext} aria-label="Next page" className={canNext ? PAGE_CLS.btn : PAGE_CLS.disabled}><ChevronRight className="w-4 h-4" /></button>
      </div>
    </nav>
  )
}


/** A cursor-paged API ({ items, next_cursor }) as numbered pages; keeps the cursor of each page seen. */
export function useCursorPages<T>(url: string, size = 20) {
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [data, setData] = useState<{ items: T[]; next: string | null } | null>(null)
  const cursor = cursors[page - 1] ?? null
  useEffect(() => {
    let live = true
    setData(null)
    fetch(`${url}${url.includes('?') ? '&' : '?'}limit=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      .then(r => r.json()).then(d => live && setData({ items: d.items ?? [], next: d.next_cursor ?? null }))
      .catch(() => live && setData({ items: [], next: null }))
    return () => { live = false }
  }, [url, size, cursor])
  const go = (p: number) => {
    if (p > page && data?.next) setCursors(cs => [...cs.slice(0, page), data.next])
    setPage(p)
  }
  return { items: data?.items ?? null, page, hasNext: !!data?.next, go }
}

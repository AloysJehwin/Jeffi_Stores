import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const PAGE_SIZE = 20

/** 1 … 4 5 [6] 7 8 … 20 */
export function pageWindow(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const out: Array<number | '…'> = [1]
  const from = Math.max(2, page - 1), to = Math.min(pages - 1, page + 1)
  if (from > 2) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < pages - 1) out.push('…')
  out.push(pages)
  return out
}

export const pageParam = (v: string | string[] | undefined, pages: number) =>
  Math.min(Math.max(1, parseInt(String(v ?? '1'), 10) || 1), Math.max(1, pages))

const BTN = 'ecom-focus inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm font-semibold transition-colors'
export const PAGE_CLS = {
  wrap: 'flex flex-wrap items-center justify-between gap-3 pt-4',
  info: 'text-xs text-foreground-muted tabular-nums',
  btn: `${BTN} org-sand org-sand-hover text-foreground`,
  active: `${BTN} ecom-sel`,
  disabled: `${BTN} org-sand opacity-40 pointer-events-none`,
}

/** Server-rendered pager: each page is a ?page=N link (other query params kept). */
export function PageLinks({ page, total, pageSize = PAGE_SIZE, base, params = {} }: {
  page: number; total: number; pageSize?: number; base: string; params?: Record<string, string | undefined>
}) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]))
    if (p > 1) q.set('page', String(p))
    const s = q.toString()
    return s ? `${base}?${s}` : base
  }
  const first = (page - 1) * pageSize + 1
  return (
    <nav className={PAGE_CLS.wrap} aria-label="Pagination">
      <span className={PAGE_CLS.info}>{first}–{Math.min(page * pageSize, total)} of {total.toLocaleString('en-IN')}</span>
      <div className="flex items-center gap-1.5">
        <Link href={href(page - 1)} aria-label="Previous page" className={page <= 1 ? PAGE_CLS.disabled : PAGE_CLS.btn}><ChevronLeft className="w-4 h-4" /></Link>
        {pageWindow(page, pages).map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} className="px-1 text-foreground-muted">…</span>
            : <Link key={p} href={href(p)} aria-current={p === page ? 'page' : undefined} className={p === page ? PAGE_CLS.active : PAGE_CLS.btn}>{p}</Link>
        )}
        <Link href={href(page + 1)} aria-label="Next page" className={page >= pages ? PAGE_CLS.disabled : PAGE_CLS.btn}><ChevronRight className="w-4 h-4" /></Link>
      </div>
    </nav>
  )
}

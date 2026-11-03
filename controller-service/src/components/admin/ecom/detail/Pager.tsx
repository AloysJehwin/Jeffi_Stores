import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Newer / older page links for a server-paged table (?tp, ?lp, …). Hrefs are built by the page. */
export default function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const last = Math.max(1, Math.ceil(total / pageSize))
  if (last <= 1 && page <= 1) return null
  const cls = 'control-sm border border-border-default text-foreground hover:bg-surface-secondary'
  const off = 'control-sm border border-border-default text-foreground-muted opacity-50 pointer-events-none'
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-foreground-muted" aria-label="Pages">
      {page > 1 ? (
        <Link href={href(page - 1)} scroll={false} className={cls}>
          <ChevronLeft className="w-3.5 h-3.5" /> Newer
        </Link>
      ) : (
        <span className={off}>
          <ChevronLeft className="w-3.5 h-3.5" /> Newer
        </span>
      )}
      <span className="tabular-nums">
        Page {page} of {last}
      </span>
      {page < last ? (
        <Link href={href(page + 1)} scroll={false} className={cls}>
          Older <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      ) : (
        <span className={off}>
          Older <ChevronRight className="w-3.5 h-3.5" />
        </span>
      )}
    </nav>
  )
}

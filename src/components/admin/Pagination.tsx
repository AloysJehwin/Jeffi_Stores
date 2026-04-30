import Link from 'next/link'

interface PaginationProps {
  page: number
  total: number
  pageSize: number
  buildUrl: (page: number) => string
}

export default function Pagination({ page, total, pageSize, buildUrl }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const pages: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }

  const btnBase = 'inline-flex items-center justify-center h-8 min-w-[2rem] px-2 rounded text-sm font-medium transition-colors'
  const active = `${btnBase} bg-accent-500 text-white`
  const inactive = `${btnBase} text-foreground-secondary hover:bg-surface-secondary border border-border-default`
  const disabled = `${btnBase} text-foreground-muted border border-border-default opacity-40 pointer-events-none`

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 pt-4">
      <p className="text-sm text-foreground-muted">
        Showing <span className="font-medium text-foreground">{start}–{end}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span> results
      </p>
      <div className="flex items-center gap-1">
        <Link href={buildUrl(page - 1)} className={page <= 1 ? disabled : inactive} aria-label="Previous">
          ‹
        </Link>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1 text-foreground-muted text-sm">…</span>
          ) : (
            <Link key={p} href={buildUrl(p as number)} className={p === page ? active : inactive}>
              {p}
            </Link>
          )
        )}
        <Link href={buildUrl(page + 1)} className={page >= totalPages ? disabled : inactive} aria-label="Next">
          ›
        </Link>
      </div>
    </div>
  )
}

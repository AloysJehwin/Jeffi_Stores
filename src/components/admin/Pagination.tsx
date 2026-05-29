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

  const btnCls = 'px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors'

  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-4">
      <p className="text-xs text-foreground-muted whitespace-nowrap">
        <span className="font-medium text-foreground">{start}–{end}</span>
        {' '}of <span className="font-medium text-foreground">{total}</span> results
      </p>
      <div className="flex items-center gap-1.5">
        <Link href={buildUrl(page - 1)} className={`${btnCls} ${page <= 1 ? 'opacity-40 pointer-events-none' : ''}`} aria-label="Previous">
          Prev
        </Link>
        <span className="text-xs text-foreground-muted whitespace-nowrap">{page}/{totalPages}</span>
        <Link href={buildUrl(page + 1)} className={`${btnCls} ${page >= totalPages ? 'opacity-40 pointer-events-none' : ''}`} aria-label="Next">
          Next
        </Link>
      </div>
    </div>
  )
}

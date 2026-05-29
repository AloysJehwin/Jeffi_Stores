import Link from 'next/link'

interface PaginationProps {
  page: number
  totalPages: number
  buildHref: (page: number) => string
}

export default function Pagination({ page, totalPages, buildHref }: PaginationProps) {
  if (totalPages <= 1) return null

  const btnCls = 'px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors'

  return (
    <div className="flex items-center justify-between mt-8 mb-4 gap-2">
      <Link
        href={buildHref(page - 1)}
        className={`${btnCls} ${page <= 1 ? 'opacity-40 pointer-events-none' : ''}`}
        aria-disabled={page <= 1}
      >
        Prev
      </Link>
      <span className="text-xs text-foreground-muted whitespace-nowrap">{page}/{totalPages}</span>
      <Link
        href={buildHref(page + 1)}
        className={`${btnCls} ${page >= totalPages ? 'opacity-40 pointer-events-none' : ''}`}
        aria-disabled={page >= totalPages}
      >
        Next
      </Link>
    </div>
  )
}

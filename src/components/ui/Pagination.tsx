import Link from 'next/link'

interface PaginationProps {
  page: number
  totalPages: number
  buildHref: (page: number) => string
}

export default function Pagination({ page, totalPages, buildHref }: PaginationProps) {
  if (totalPages <= 1) return null

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
      acc.push(p)
      return acc
    }, [])

  return (
    <div className="flex items-center justify-between mt-8 mb-4 gap-2 sm:gap-4">
      <Link
        href={buildHref(page - 1)}
        className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border font-medium text-sm transition-colors shrink-0 ${
          page <= 1
            ? 'border-border-default text-foreground-muted pointer-events-none opacity-40'
            : 'border-border-secondary text-foreground-secondary hover:bg-surface-secondary'
        }`}
        aria-disabled={page <= 1}
      >
        <span className="hidden sm:inline">←</span> Previous
      </Link>

      <div className="flex items-center gap-1 overflow-hidden">
        {pages.map((item, idx) =>
          item === 'ellipsis' ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-foreground-muted">…</span>
          ) : (
            <Link
              key={item}
              href={buildHref(item)}
              className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition-colors shrink-0 ${
                item === page
                  ? 'bg-accent-500 text-white'
                  : 'text-foreground-secondary hover:bg-surface-secondary border border-border-secondary'
              }`}
              aria-current={item === page ? 'page' : undefined}
            >
              {item}
            </Link>
          ),
        )}
      </div>

      <Link
        href={buildHref(page + 1)}
        className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border font-medium text-sm transition-colors shrink-0 ${
          page >= totalPages
            ? 'border-border-default text-foreground-muted pointer-events-none opacity-40'
            : 'border-border-secondary text-foreground-secondary hover:bg-surface-secondary'
        }`}
        aria-disabled={page >= totalPages}
      >
        Next <span className="hidden sm:inline">→</span>
      </Link>
    </div>
  )
}

import Link from 'next/link'

interface PaginationProps {
  page: number
  total: number
  pageSize: number
  buildUrl?: (page: number) => string
  onPageChange?: (page: number) => void
}

export default function Pagination({ page, total, pageSize, buildUrl, onPageChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const btnCls = 'control-xs font-medium border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors'

  const navBtn = (targetPage: number, label: string, disabled: boolean) => {
    if (onPageChange) {
      return (
        <button type="button" onClick={() => onPageChange(targetPage)} disabled={disabled} className={btnCls} aria-label={label}>
          {label}
        </button>
      )
    }
    return (
      <Link href={buildUrl!(targetPage)} className={`${btnCls} ${disabled ? 'opacity-40 pointer-events-none' : ''}`} aria-label={label}>
        {label}
      </Link>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-4">
      <p className="text-xs text-foreground-muted whitespace-nowrap">
        <span className="font-medium text-foreground">{start}–{end}</span>
        {' '}of <span className="font-medium text-foreground">{total}</span> results
      </p>
      <div className="flex items-center gap-1.5">
        {navBtn(page - 1, 'Prev', page <= 1)}
        <span className="text-xs text-foreground-muted whitespace-nowrap">{page}/{totalPages}</span>
        {navBtn(page + 1, 'Next', page >= totalPages)}
      </div>
    </div>
  )
}

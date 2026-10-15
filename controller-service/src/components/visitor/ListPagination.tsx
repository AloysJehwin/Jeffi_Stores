'use client'

// Prev/Next pager for customer account lists (rewards history, coupons, referrals).
export default function Pagination({
  page,
  total,
  pageSize,
  onChange,
  busy,
}: {
  page: number
  total: number
  pageSize: number
  onChange: (page: number) => void
  busy?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border-default pt-3">
      <p className="text-xs text-foreground-muted">
        {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1 || busy}
          className="px-3 py-1.5 rounded-lg border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <span className="text-xs text-foreground-muted tabular-nums">
          {page} / {pages}
        </span>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= pages || busy}
          className="px-3 py-1.5 rounded-lg border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  )
}

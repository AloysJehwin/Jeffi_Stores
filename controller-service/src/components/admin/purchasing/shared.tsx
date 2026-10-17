import { formatINR as formatINRBase } from '@/lib/shared/format'
import { Kpi } from '@/components/admin/kit/core'
import { TONE_CLS } from '@/components/admin/kit/tones'

// Helpers shared by the inventory, suppliers and purchase-order pages.


export const inputCls =
  'w-full field-sm border border-border-default bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
export const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
export const btnPrimary =
  'control-sm border border-transparent bg-accent-500 hover:bg-accent-600 text-white font-medium transition-colors disabled:opacity-50'
export const btnSecondary =
  'control-sm border border-border-default bg-surface hover:bg-surface-secondary text-foreground font-medium transition-colors'

export const PAGE_SIZE = 20
export const STOCK_PAGE_SIZE = 50
export const VALUATION_PAGE_SIZE = 50

export const formatINR = (n: number) => formatINRBase(n, 0)

export function fmtINR2(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Same look as the kit `Kpi`; `accent` is its `highlight`. */
export function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return <Kpi label={label} value={value} sub={sub} highlight={accent} />
}

export function ClientPagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number
  total: number
  pageSize: number
  onChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  const btnCls =
    'control-xs font-medium border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors'

  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-4 border-t border-border-default mt-2">
      <p className="text-xs text-foreground-muted whitespace-nowrap">
        <span className="font-medium text-foreground">
          {start}–{end}
        </span>{' '}
        of <span className="font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1} className={btnCls}>
          Prev
        </button>
        <span className="text-xs text-foreground-muted whitespace-nowrap">
          {page}/{totalPages}
        </span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} className={btnCls}>
          Next
        </button>
      </div>
    </div>
  )
}

export const STATUS_BADGE: Record<string, string> = {
  draft: TONE_CLS.muted,
  sent: TONE_CLS.blue,
  partial: TONE_CLS.amber,
  received: TONE_CLS.green,
  cancelled: TONE_CLS.red,
}

export const TYPE_BADGE: Record<string, string> = {
  purchase: TONE_CLS.green,
  sale: TONE_CLS.red,
  return: TONE_CLS.blue,
  adjustment: TONE_CLS.amber,
}

export type Supplier = {
  id: string
  name: string
  gstin: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  payment_terms: number
  is_active: boolean
  po_count: number
  address: string | null
  notes: string | null
  bank_name: string | null
  account_number: string | null
  ifsc: string | null
  upi_id: string | null
}

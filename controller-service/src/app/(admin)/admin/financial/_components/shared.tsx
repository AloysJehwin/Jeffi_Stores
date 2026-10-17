'use client'

import { formatINR as formatINRBase, formatDate as formatDateBase } from '@/lib/shared/format'
import { Kpi, TableSkeleton, badgeCls, fieldInputCls, type StatusMap, type Tone } from '@/components/admin/kit'

export type Tab =
  'overview' | 'receivables' | 'payables' | 'transactions' | 'pl' | 'cashflow' | 'cod_remittance' | 'messaging' | 'ai_costs'

export const inputCls = fieldInputCls
export const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1.5'
export const btnPrimary = 'control-md bg-accent-500 text-white font-medium hover:bg-accent-600 transition-colors disabled:opacity-50'
export const btnSecondary = 'control-md border border-border-default bg-surface-elevated text-foreground font-medium hover:bg-surface-secondary transition-colors disabled:opacity-50'

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
]

export const PAYOUT_MODE_OPTIONS = [
  { value: 'IMPS', label: 'IMPS (instant)' },
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'UPI', label: 'UPI' },
]

export const formatINR = (n: number) => formatINRBase(n, 0)
export const formatDate = (s: string) => formatDateBase(s, '')

export function agingBadge(bucket: string) {
  const tone = bucket === '0-30' ? 'green' : bucket === '31-60' ? 'amber' : 'red'
  return <span className={badgeCls(tone)}>{tone === 'red' ? '60+' : bucket}d</span>
}

// Receivable/payable settlement statuses (paid | partial | unpaid).
export const SETTLEMENT_STATUS: StatusMap = {
  paid: { label: 'paid', tone: 'green' },
  partial: { label: 'partial', tone: 'amber' },
  unpaid: { label: 'unpaid', tone: 'red' },
}

export function StatusBadge({ status }: { status: string }) {
  const hit = SETTLEMENT_STATUS[status]
  return <span className={badgeCls(hit?.tone ?? 'red')}>{hit?.label ?? status}</span>
}

// RazorpayX payout lifecycle.
export function payoutBadge(status?: string | null) {
  if (!status) return <span className="text-xs text-foreground-muted">-</span>
  const tone = status === 'processed' ? 'green' : status === 'failed' || status === 'reversed' ? 'red' : 'amber'
  return <span className={badgeCls(tone)}>{status}</span>
}

// COD remittance: cod_pending -> cod_collected -> paid (remitted).
export const codTone = (s?: string): Tone => (s === 'cod_pending' ? 'amber' : s === 'cod_collected' ? 'blue' : 'green')

export function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Kpi label={label} value={value} sub={sub} />
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return <TableSkeleton rows={rows} cols={5} />
}

export const thCls = 'px-4 py-2.5 text-left text-xs font-medium text-foreground-muted whitespace-nowrap'
export const thRight = 'px-4 py-2.5 text-right text-xs font-medium text-foreground-muted whitespace-nowrap'
export const thCenter = 'px-4 py-2.5 text-center text-xs font-medium text-foreground-muted whitespace-nowrap'
export const theadCls = 'border-b border-border-default bg-surface-secondary/50'
export const tableWrapCls = 'rounded-xl border border-border-default bg-surface-elevated'
export const tableWrapClippedCls = `${tableWrapCls} overflow-hidden`
export const pagerBtn = 'control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

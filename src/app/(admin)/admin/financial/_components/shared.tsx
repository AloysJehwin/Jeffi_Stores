'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { formatINR as formatINRBase, formatDate as formatDateBase } from '@/lib/shared/format'

export type Tab = 'overview' | 'receivables' | 'payables' | 'transactions' | 'pl' | 'cashflow' | 'cod_remittance'

export const inputCls =
  'w-full px-3 py-1.5 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400'
export const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
export const btnPrimary =
  'control-sm border border-transparent bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 font-medium transition-colors disabled:opacity-50'
export const btnSecondary =
  'control-sm border border-border-default bg-surface hover:bg-surface-secondary text-foreground font-medium transition-colors'

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
  if (bucket === '0-30')
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        {bucket}d
      </span>
    )
  if (bucket === '31-60')
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
        {bucket}d
      </span>
    )
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      60+d
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'paid'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      : status === 'partial'
        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>
}

export function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-secondary mb-1">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-foreground-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-border-default overflow-hidden">
      <div className="bg-surface-secondary h-10" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-t border-border-default px-4 py-3 flex gap-4">
          <div className="h-4 bg-surface-secondary rounded w-32 animate-pulse" />
          <div className="h-4 bg-surface-secondary rounded w-24 animate-pulse" />
          <div className="h-4 bg-surface-secondary rounded flex-1 animate-pulse" />
          <div className="h-4 bg-surface-secondary rounded w-20 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export const thCls = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary'
export const thRight = 'px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary'
export const thCenter = 'px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary'

// ── Portal Modal ─────────────────────────────────────────────────────────────

export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {children}
    </div>,
    document.body
  )
}

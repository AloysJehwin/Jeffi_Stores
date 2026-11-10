'use client'

import { useId, type ReactNode } from 'react'
import { Banknote, CreditCard, PhoneCall } from 'lucide-react'

// Payment picker shared by checkout, pay-now, wallet top-ups and subscriptions: a "UPI" section and an
// "Other payment methods" section (Razorpay's cards / net banking / wallets / EMI, plus COD and the B2B
// manual option when the host has them). Radio semantics; the host keeps its own pay button.

export type PaymentChoice = 'upi' | 'razorpay' | 'cod' | 'manual'

export interface PaymentRow {
  title?: string
  description?: ReactNode
  /** Shown under the row while it is selected. */
  note?: ReactNode
  disabled?: boolean
}

export interface PaymentSectionsProps {
  amountInr?: number | null
  /** UPI section (PhonePe hosted page or our UPI checkout page). `true` uses the default copy. */
  upi?: boolean | PaymentRow
  /** Cards, net banking, wallets and EMI through Razorpay Checkout. */
  razorpay?: boolean | PaymentRow
  cod?: boolean | PaymentRow
  manual?: boolean | PaymentRow
  value: PaymentChoice | null
  onChange: (v: PaymentChoice) => void
  /** Tighter rows for sidebars and banners. */
  compact?: boolean
  /** Radio group name when several pickers share a page. */
  name?: string
  /** `autopay`: subscription copy (UPI Autopay mandate, recurring card). */
  mode?: 'oneoff' | 'autopay'
  /** Drops the UPI section whatever `upi` says (e.g. subscriptions on a store without UPI Autopay). */
  hideUpi?: boolean
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The UPI glyph: the two chevrons, with "UPI" beside them. */
export function UpiMark({ className = 'h-7 w-auto' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 28" className={className} aria-hidden focusable="false">
      <path d="M11 3h6l6 11-6 11h-6l6-11z" fill="#ef7f1a" />
      <path d="M3 3h6l6 11-6 11H3l6-11z" fill="#1a8c3a" />
      <text x="29" y="20" fontSize="15" fontWeight="800" fontFamily="system-ui, sans-serif" fill="currentColor" letterSpacing="0.5">
        UPI
      </text>
    </svg>
  )
}

function rowOf(v: boolean | PaymentRow | undefined): PaymentRow | null {
  if (!v) return null
  return v === true ? {} : v
}

export default function PaymentSections({ amountInr, upi, razorpay, cod, manual, value, onChange, compact, name, mode = 'oneoff', hideUpi }: PaymentSectionsProps) {
  const autoName = useId()
  const group = name ?? `pay-${autoName}`
  const upiRow = hideUpi ? null : rowOf(upi)
  const rzpRow = rowOf(razorpay)
  const codRow = rowOf(cod)
  const manualRow = rowOf(manual)
  const autopay = mode === 'autopay'

  const others: { key: PaymentChoice; row: PaymentRow; title: string; description: ReactNode; icon: ReactNode }[] = []
  if (rzpRow)
    others.push({
      key: 'razorpay',
      row: rzpRow,
      title: rzpRow.title ?? (autopay ? 'Card' : 'Cards, net banking, wallets & EMI'),
      description: rzpRow.description ?? (autopay ? 'Recurring charge on a credit or debit card · via Razorpay' : 'Credit & debit cards, net banking, wallets, EMI · via Razorpay'),
      icon: <CreditCard className="h-6 w-6 shrink-0 text-accent-500" aria-hidden />,
    })
  if (codRow)
    others.push({
      key: 'cod',
      row: codRow,
      title: codRow.title ?? 'Cash on Delivery',
      description: codRow.description ?? 'Pay when your order arrives',
      icon: <Banknote className="h-6 w-6 shrink-0 text-green-600 dark:text-green-400" aria-hidden />,
    })
  if (manualRow)
    others.push({
      key: 'manual',
      row: manualRow,
      title: manualRow.title ?? 'Contact for Payment',
      description: manualRow.description ?? 'Our team will reach out to arrange payment',
      icon: <PhoneCall className="h-6 w-6 shrink-0 text-foreground-muted" aria-hidden />,
    })

  const pad = compact ? 'gap-3 p-3' : 'gap-4 p-4'
  const titleCls = compact ? 'text-sm' : 'text-sm sm:text-base'
  const descCls = compact ? 'text-xs' : 'text-xs sm:text-sm'

  const renderRow = (key: PaymentChoice, row: PaymentRow, title: string, description: ReactNode, icon: ReactNode) => {
    const on = value === key
    return (
      <div key={key}>
        <label
          className={`flex cursor-pointer items-center rounded-lg border-2 transition-colors ${pad} ${
            on ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default hover:border-border-secondary'
          } ${row.disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <input
            type="radio"
            name={group}
            value={key}
            checked={on}
            disabled={row.disabled}
            onChange={() => onChange(key)}
            className="h-4 w-4 shrink-0 text-accent-600 focus:ring-accent-500"
          />
          <span className="min-w-0 flex-1">
            <span className={`block font-semibold text-foreground ${titleCls}`}>{title}</span>
            {description && <span className={`block text-foreground-secondary ${descCls}`}>{description}</span>}
          </span>
          {icon}
        </label>
        {on && row.note && <div className="mt-2 text-xs text-foreground-secondary">{row.note}</div>}
      </div>
    )
  }

  if (!upiRow && others.length === 0) return null

  return (
    <div className="space-y-4">
      {upiRow && (
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">UPI</legend>
          {renderRow(
            'upi',
            upiRow,
            upiRow.title ?? (autopay ? 'UPI Autopay' : 'UPI'),
            upiRow.description ??
              (autopay
                ? `Approve a recurring mandate in your UPI app${amountInr ? ` · ${inr(amountInr)} each cycle` : ''}`
                : 'Pay with any UPI app (PhonePe, GPay, Paytm, BHIM…)'),
            <UpiMark className="h-7 w-auto shrink-0 text-foreground" />
          )}
        </fieldset>
      )}
      {others.length > 0 && (
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">{upiRow ? 'Other payment methods' : 'Payment methods'}</legend>
          <div className="space-y-2">{others.map(o => renderRow(o.key, o.row, o.title, o.description, o.icon))}</div>
        </fieldset>
      )}
    </div>
  )
}

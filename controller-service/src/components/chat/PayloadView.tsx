'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ConfirmPayload, SupportPayload } from '@/lib/support/types'

const STATUS_TONE: Record<string, string> = {
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  shipped: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function ConfirmCard({ p, onDecide }: { p: ConfirmPayload; onDecide?: (actionId: string, d: 'confirm' | 'decline') => Promise<void> }) {
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null)
  const decide = async (d: 'confirm' | 'decline') => {
    if (!onDecide || busy) return
    setBusy(d)
    try {
      await onDecide(p.actionId, d)
    } finally {
      setBusy(null)
    }
  }
  const settled =
    p.status === 'done' ? 'Done' : p.status === 'confirmed' ? 'Confirmed, working on it…' : p.status === 'declined' ? 'Declined' : p.status === 'failed' ? 'Could not complete' : p.status === 'expired' ? 'Expired' : null
  return (
    <div className="rounded-xl border border-border-default bg-surface p-3 space-y-2 text-foreground">
      <p className="text-sm font-semibold">{p.title}</p>
      {p.detail && <p className="text-xs text-foreground-secondary whitespace-pre-wrap">{p.detail}</p>}
      {p.status === 'pending' && onDecide ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => decide('confirm')}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-60"
          >
            {busy === 'confirm' ? 'Working…' : p.confirmLabel || 'Confirm'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => decide('decline')}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold border border-border-default hover:bg-surface-secondary disabled:opacity-60"
          >
            {busy === 'decline' ? '…' : 'No, keep it'}
          </button>
        </div>
      ) : (
        <p className={`text-xs font-medium ${p.status === 'failed' ? 'text-red-500' : p.status === 'done' ? 'text-emerald-600' : 'text-foreground-muted'}`}>
          {p.status === 'pending' ? 'Waiting for the customer to confirm' : settled}
          {p.resultText ? ` · ${p.resultText}` : ''}
        </p>
      )}
    </div>
  )
}

interface Props {
  payloads: SupportPayload[]
  /** Customer only: answer an action the assistant proposed. */
  onDecide?: (actionId: string, d: 'confirm' | 'decline') => Promise<void>
  /** Customer only: a suggestion chip sends its text. */
  onChip?: (text: string) => void
  /** Where an order card leads (customer: their order page; admin: the order in admin). */
  orderHref?: (id: string) => string
}

/** Rich parts of a message: confirm cards, order cards, reply chips, links. */
export default function PayloadView({ payloads, onDecide, onChip, orderHref }: Props) {
  if (!payloads.length) return null
  return (
    <div className="space-y-2 mt-1.5">
      {payloads.map((p, i) => {
        if (p.type === 'confirm') return <ConfirmCard key={i} p={p} onDecide={onDecide} />
        if (p.type === 'orders')
          return (
            <div key={i} className="space-y-1.5">
              {p.orders.map(o => {
                const body = (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">#{o.number}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_TONE[o.status] ?? 'bg-surface-secondary text-foreground-secondary'}`}>
                        {o.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {o.items && <p className="text-xs text-foreground-secondary truncate mt-0.5">{o.items}</p>}
                    <div className="flex items-center justify-between mt-0.5 text-[11px] text-foreground-muted">
                      <span>{new Date(o.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span className="font-semibold text-foreground">{inr(o.total)}</span>
                    </div>
                  </>
                )
                const cls = 'block w-full text-left px-3 py-2 rounded-xl border border-border-default bg-surface text-foreground'
                return orderHref ? (
                  <a key={o.id} href={orderHref(o.id)} className={`${cls} hover:border-primary-300 dark:hover:border-primary-700`}>
                    {body}
                  </a>
                ) : (
                  <div key={o.id} className={cls}>
                    {body}
                  </div>
                )
              })}
            </div>
          )
        if (p.type === 'chips')
          return (
            <div key={i} className="flex flex-wrap gap-1.5">
              {p.chips.map(c => (
                <button
                  key={c.label}
                  type="button"
                  disabled={!onChip}
                  onClick={() => onChip?.(c.text)}
                  className="px-3 py-1.5 text-xs font-medium rounded-full border border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 enabled:hover:bg-primary-100 dark:enabled:hover:bg-primary-900/40 disabled:opacity-70"
                >
                  {c.label}
                </button>
              ))}
            </div>
          )
        if (p.type === 'links')
          return (
            <div key={i} className="space-y-1">
              {p.links.map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  target={/^https?:/.test(l.href) ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border-default hover:border-primary-300 dark:hover:border-primary-700 text-sm text-foreground"
                >
                  <span className="truncate">{l.label}</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-auto text-foreground-muted shrink-0" />
                </a>
              ))}
            </div>
          )
        return null
      })}
    </div>
  )
}

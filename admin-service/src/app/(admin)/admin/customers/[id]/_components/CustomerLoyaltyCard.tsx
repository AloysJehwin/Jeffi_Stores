'use client'

import { useCallback, useEffect, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'

interface LedgerEntry {
  id: string
  delta: number
  reason: string
  orderNumber: string | null
  couponCode: string | null
  note: string | null
  createdAt: string
}

interface LoyaltyView {
  enabled: boolean
  eligible: boolean
  account: { points: number; lifetimePoints: number; tier: string; tierName: string }
  ledger: LedgerEntry[]
}

const inputClass =
  'w-full px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500'

function entryLabel(entry: LedgerEntry): string {
  const order = entry.orderNumber ? `Order ${entry.orderNumber}` : 'Order'
  switch (entry.reason) {
    case 'order_earn':
      return order
    case 'order_reversal':
      return `${order} returned or cancelled`
    case 'redeem':
      return `Redeemed ${entry.couponCode ?? 'for a coupon'}`
    case 'redeem_refund':
      return `Points returned for ${entry.couponCode ?? 'a coupon'}`
    case 'referral':
      return entry.orderNumber ? `Referral reward (friend's order ${entry.orderNumber})` : 'Referral reward'
    case 'referral_reversal':
      return entry.orderNumber
        ? `Referral reward taken back (friend's order ${entry.orderNumber} returned)`
        : 'Referral reward taken back'
    default:
      return entry.note || 'Adjustment'
  }
}

export default function CustomerLoyaltyCard({ customerId }: { customerId: string }) {
  const canWrite = useCanWrite('customers')
  const { showToast } = useToast()
  const [view, setView] = useState<LoyaltyView | null>(null)
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/loyalty`)
      if (res.ok) setView(await res.json())
    } catch {
      setView(null)
    }
  }, [customerId])

  useEffect(() => {
    load()
  }, [load])

  if (!view || !view.enabled || (!view.eligible && view.ledger.length === 0)) return null

  const points = /^-?\d+$/.test(delta) ? parseInt(delta, 10) : 0
  const valid = points !== 0 && note.trim().length > 0

  const adjust = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/loyalty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: points, note: note.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(body?.error || 'Could not adjust points', 'error')
        return
      }
      setView(body)
      setDelta('')
      setNote('')
      showToast('Points adjusted', 'success')
    } catch {
      showToast('Could not adjust points', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-4">Loyalty</h2>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xl font-bold text-foreground">{view.account.points.toLocaleString('en-IN')}</p>
        <span className="text-sm font-medium text-foreground-secondary">{view.account.tierName}</span>
      </div>
      <p className="text-xs text-foreground-muted">
        points, {view.account.lifetimePoints.toLocaleString('en-IN')} ever earned
      </p>

      {view.ledger.length > 0 && (
        <ul className="mt-4 space-y-2">
          {view.ledger.slice(0, 6).map(entry => (
            <li key={entry.id} className="flex items-start justify-between gap-3 text-xs">
              <span className="text-foreground-secondary">
                {entryLabel(entry)}
                <span className="block text-foreground-muted">
                  {new Date(entry.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </span>
              <span className={entry.delta > 0 ? 'font-semibold text-green-600 dark:text-green-400' : 'font-semibold'}>
                {entry.delta > 0 ? '+' : ''}
                {entry.delta.toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canWrite && view.eligible && (
        <form onSubmit={adjust} className="mt-4 pt-4 border-t border-border-default space-y-2">
          <label htmlFor="loyalty-delta" className="block text-xs font-medium text-foreground-secondary">
            Adjust points
          </label>
          <input
            id="loyalty-delta"
            inputMode="numeric"
            value={delta}
            onChange={e => setDelta(e.target.value.replace(/[^\d-]/g, '').slice(0, 8))}
            placeholder="50 or -50"
            className={inputClass}
          />
          <input
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 500))}
            placeholder="Reason (kept in the history)"
            aria-label="Reason for the adjustment"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={!valid || saving}
            className="w-full px-3 h-control-sm text-sm font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50"
          >
            {saving ? 'Applying' : 'Apply'}
          </button>
        </form>
      )}
    </div>
  )
}

'use client'

import { Card } from '@/components/admin/kit/layout'
import { StatusBadge } from '@/components/admin/kit/status'
import { statusMap } from './status'
import { formatWhen, showValue, timeAgo } from '@/lib/admin/change-log-format'
import type { FieldChange } from '@/lib/admin/change-log'
import { useChangeLog } from './useChangeLog'

// An order's status, payment and shipment moves, oldest first: placed, then each change with who
// made it (an admin, the customer, Razorpay, Delhivery) and when.

const FIELDS = ['status', 'payment_status', 'shipment_status']
const LABEL: Record<string, string> = { status: 'Order', payment_status: 'Payment', shipment_status: 'Shipment' }

interface Step {
  key: string
  at: string
  who: string
  placed?: boolean
  changes: FieldChange[]
}

export default function OrderStatusHistory({ orderId, placedAt, version }: { orderId: string; placedAt?: string | null; version?: unknown }) {
  const log = useChangeLog('order', orderId, { fields: FIELDS, version, limit: 100 })

  const steps: Step[] = []
  for (const item of [...log.items].reverse()) {
    const parent = item.parts.find(p => !p.child)
    if (!parent) continue
    const changes = parent.changes.filter(c => FIELDS.includes(c.field))
    if (parent.action === 'create') steps.push({ key: item.id, at: item.at, who: item.actor.name, placed: true, changes: [] })
    else if (changes.length) steps.push({ key: item.id, at: item.at, who: item.actor.name, changes })
  }
  // Orders from before the change log started have no "placed" row.
  if (placedAt && !steps.some(s => s.placed)) steps.unshift({ key: 'placed', at: placedAt, who: '', placed: true, changes: [] })

  return (
    <Card title="Status history">
      {log.loading ? (
        <p className="text-xs text-foreground-muted">Loading…</p>
      ) : log.error && !steps.length ? (
        <p className="text-xs text-foreground-muted">
          Couldn’t load the history.{' '}
          <button type="button" onClick={log.reload} className="text-accent-600 hover:underline">
            Retry
          </button>
        </p>
      ) : (
        <ol className="relative">
          {steps.map((s, i) => {
            const last = i === steps.length - 1
            return (
              <li key={s.key} className="relative flex gap-3 pb-3.5 last:pb-0">
                {!last && <span className="absolute left-[5px] top-3.5 bottom-0 w-px bg-border-default" aria-hidden />}
                <span
                  className={`mt-1 w-[11px] h-[11px] shrink-0 rounded-full border-2 ${
                    last ? 'border-accent-500 bg-accent-500' : 'border-border-strong bg-surface-elevated'
                  }`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  {s.placed ? (
                    <p className="text-sm font-medium text-foreground">Order placed</p>
                  ) : (
                    <div className="space-y-1">
                      {s.changes.map(c => {
                        const to = showValue('orders', c.field, c.to)
                        return (
                          <div key={c.field} className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-foreground-muted w-16 shrink-0">{LABEL[c.field]}</span>
                            {to.kind === 'status' ? <StatusBadge status={to.status} map={statusMap(to.domain)} /> : <span className="text-xs">—</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-foreground-muted mt-0.5" title={formatWhen(s.at)}>
                    {s.who ? `${s.who} · ` : ''}
                    {timeAgo(s.at)}
                  </p>
                </div>
              </li>
            )
          })}
          {!steps.length && <li className="text-xs text-foreground-muted">No status changes recorded yet.</li>}
        </ol>
      )}
      {log.hasMore && !log.loading && (
        <button type="button" onClick={log.loadMore} className="mt-2 text-xs text-accent-600 hover:underline">
          Older changes
        </button>
      )}
    </Card>
  )
}

'use client'

import Link from 'next/link'
import { Pager, usePagedRows } from '@/components/admin/kit/pager'
import type { AdminSubscriptionCycle } from '@/lib/queries/subscriptions'
import { fmtDate, inr } from '../_status'

export type CycleRow = AdminSubscriptionCycle & { orderHref: string | null }

// The subscription's charged cycles, 10 at a time.
export default function SubscriptionCycles({ cycles }: { cycles: CycleRow[] }) {
  const { shown, pager } = usePagedRows(cycles)
  const th = 'px-5 py-2.5 text-left text-xs font-medium'
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
              <th className={th}>Cycle</th>
              <th className={th}>Charged</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={th}>Payment</th>
              <th className={th}>Order</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(c => (
              <tr key={c.id} className="border-b border-border-default/60 last:border-0">
                <td className="px-5 py-2.5">#{c.cycleNumber}</td>
                <td className="px-5 py-2.5">{fmtDate(c.createdAt)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{inr(c.amount)}</td>
                <td className="px-5 py-2.5 font-mono text-xs">{c.razorpayPaymentId}</td>
                <td className="px-5 py-2.5">
                  {c.order && c.orderHref ? (
                    <Link href={c.orderHref} className="text-accent-500 hover:underline">
                      {c.order.orderNumber}
                    </Link>
                  ) : (
                    <span className="text-foreground-muted">{c.status}</span>
                  )}
                  {c.order && <span className="ml-2 text-xs text-foreground-muted">{c.order.status}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager control={pager} noun="cycles" className="px-5 pb-3" />
    </>
  )
}

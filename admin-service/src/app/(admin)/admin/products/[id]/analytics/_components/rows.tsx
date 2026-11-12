import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { rupees, type Buyer, type Referrer, type VariantSales } from './analytics'

export function ReferrerRow({ r }: { r: Referrer }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{r.referrer}</span>
      <span className="shrink-0 text-xs tabular-nums text-foreground-secondary">{r.sessions.toLocaleString()}</span>
    </div>
  )
}

export function VariantTable({ rows }: { rows: VariantSales[] }) {
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b border-border-default text-xs uppercase tracking-wide text-foreground-muted">
          <th className="py-2 text-left font-semibold">Variant</th>
          <th className="py-2 pl-3 text-right font-semibold">Orders</th>
          <th className="py-2 pl-3 text-right font-semibold">Qty</th>
          <th className="py-2 pl-3 text-right font-semibold">Revenue</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border-default">
        {rows.map((v, i) => (
          <tr key={i}>
            <td className="py-2 text-foreground">{v.variantName || <span className="italic text-foreground-muted">No variant</span>}</td>
            <td className="py-2 pl-3 text-right tabular-nums">{v.orders}</td>
            <td className="py-2 pl-3 text-right tabular-nums">{v.quantity}</td>
            <td className="py-2 pl-3 text-right font-semibold tabular-nums">{rupees(v.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function BuyerRow({ b, large }: { b: Buyer; large?: boolean }) {
  return (
    <Link
      href={ap(`/admin/orders?search=${b.orderNumber}`)}
      className={`flex items-center justify-between text-sm ${large ? 'py-2.5' : 'py-1.5'} -mx-2 rounded px-2 transition-colors hover:bg-surface-secondary/50`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{b.customerName}</p>
        <p className="text-xs text-foreground-muted">
          {new Date(b.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {b.quantity}× #{b.orderNumber}
        </p>
      </div>
      <span className="ml-3 whitespace-nowrap font-semibold tabular-nums text-foreground">{rupees(b.total)}</span>
    </Link>
  )
}

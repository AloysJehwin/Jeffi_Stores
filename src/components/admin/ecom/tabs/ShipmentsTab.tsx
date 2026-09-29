import type { ShipmentRow } from '@/lib/tenant-shipments-shared'
import { Section } from '../EcomUI'
import ShipmentCorrection from './ShipmentCorrection'

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const num = (v: string | null) => (v == null ? null : Number(v))

export default function ShipmentsTab({
  tenantId, ownDelhivery, shipments,
}: {
  tenantId: string
  ownDelhivery: boolean
  shipments: ShipmentRow[]
}) {
  return (
    <div className="space-y-6 min-w-0">
      <Section title="Shipments">
        <p className="text-xs text-foreground-muted mb-4">
          {ownDelhivery
            ? 'This tenant ships on their own Delhivery account and is billed directly — charges are read-only here.'
            : 'Platform-Delhivery: the wallet is debited the real charge post-pickup. Correct a charge if Delhivery re-priced it after weight capture.'}
        </p>
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-foreground-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Order</th>
                <th className="text-left px-4 py-3 font-medium">AWB</th>
                <th className="text-left px-4 py-3 font-medium">Mode</th>
                <th className="text-right px-4 py-3 font-medium">Quoted</th>
                <th className="text-right px-4 py-3 font-medium">Billed</th>
                <th className="text-right px-4 py-3 font-medium">Extra</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                {!ownDelhivery && <th className="text-right px-4 py-3 font-medium">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {shipments.length === 0 && (
                <tr>
                  <td colSpan={ownDelhivery ? 7 : 8} className="px-4 py-8 text-center text-foreground-muted">
                    No shipments with an AWB yet.
                  </td>
                </tr>
              )}
              {shipments.map((s) => {
                const quoted = num(s.shipping_amount)
                const billed = num(s.delhivery_billed_amount)
                const extra = num(s.delhivery_extra_charge)
                return (
                  <tr key={s.id} className="hover:bg-surface-secondary align-middle">
                    <td className="px-4 py-3 font-medium text-foreground">{s.order_number || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary">{s.awb_number}</td>
                    <td className="px-4 py-3 text-foreground-secondary">{s.payment_mode === 'cod' ? 'COD' : 'Prepaid'}</td>
                    <td className="px-4 py-3 text-right text-foreground">{quoted != null ? inr(quoted) : '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground">{billed != null ? inr(billed) : '—'}</td>
                    <td className={`px-4 py-3 text-right ${extra && extra > 0 ? 'text-red-600 dark:text-red-400' : extra && extra < 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}`}>
                      {extra != null ? (extra >= 0 ? '+' : '−') + inr(Math.abs(extra)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{s.shipment_status || '—'}</td>
                    {!ownDelhivery && (
                      <td className="px-4 py-3 text-right">
                        <ShipmentCorrection
                          tenantId={tenantId}
                          orderId={s.id}
                          awb={s.awb_number || ''}
                          currentBilled={billed}
                          alreadyBilled={s.delhivery_billed_at != null}
                        />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

import type { ShipmentRow } from '@controller/lib/orders/tenant-shipments-shared'
import { Section } from '../EcomUI'
import ShipmentsTable from '../detail/ShipmentsTable'
import BillingReconcile from './BillingReconcile'

export default function ShipmentsTab({ tenantId, ownDelhivery, shipments }: { tenantId: string; ownDelhivery: boolean; shipments: ShipmentRow[] }) {
  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <Section title="Shipments">
        <p className="text-xs text-foreground-muted mb-4">
          {ownDelhivery
            ? 'This tenant ships on their own Delhivery account and is billed directly; charges are read-only here.'
            : 'Platform Delhivery: the wallet holds an estimate at AWB creation and is netted to the real invoiced charge at delivery/RTO. Correct a charge if Delhivery re-priced it after weight capture.'}
        </p>
        <ShipmentsTable tenantId={tenantId} ownDelhivery={ownDelhivery} shipments={shipments} />
        {shipments.length >= 100 && <p className="text-xs text-foreground-muted mt-3">Latest 100 shipments.</p>}
      </Section>
      {!ownDelhivery && (
        <Section title="Delhivery billing reconciliation">
          <BillingReconcile tenantId={tenantId} />
        </Section>
      )}
    </div>
  )
}

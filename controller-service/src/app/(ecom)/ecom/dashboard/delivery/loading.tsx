import { ConsoleLoading, LinesLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Store" title="Delivery" description="Delhivery shipments and tracking for your orders.">
      <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
        <div className="text-xs text-foreground-secondary uppercase tracking-widest mb-3">Delivery account</div>
        <LinesLoading lines={2} />
      </div>
    </ConsoleLoading>
  )
}

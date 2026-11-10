import { LoadingChart, LoadingKpis, LoadingSection } from '@/components/admin/kit/skeleton'

/** The Purchase Orders overview body while its data loads. */
export default function PurchaseOrdersOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['POs raised', 'Goods received', 'Avg PO value', 'Open POs', 'Overdue deliveries', 'Partially received', 'On-time (closed)', 'Payables due']} />
      <LoadingSection title="Needs attention" lines={3} />
      <LoadingChart title="Raised vs received" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LoadingSection title="Open POs by status" lines={4} />
        <LoadingSection title="Top suppliers by spend" lines={4} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LoadingSection title="Overdue deliveries" lines={4} />
        <LoadingSection title="Partially received" lines={4} />
      </div>
      <LoadingSection title="Reorder suggestions" lines={4} />
    </>
  )
}

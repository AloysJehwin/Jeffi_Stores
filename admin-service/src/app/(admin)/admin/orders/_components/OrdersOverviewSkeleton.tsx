import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Orders overview body while its data loads. */
export default function OrdersOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Orders placed', 'Order value', 'Average order', 'Paid revenue', 'Cancel rate', 'COD share', 'Shipped', 'Time to dispatch', 'Delivered', 'Time in transit', 'On time', 'RTO rate']} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="Open orders now" lines={4} />
      </div>
      <LoadingChart title="Orders over time" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <LoadingSection title="Payment mix" lines={3} />
        <LoadingSection title="By channel" lines={3} />
        <LoadingSection title="Cancellations by reason" lines={3} />
      </div>
      <LoadingSection title="Top states">
        <LoadingTable bare rows={5} columns={['State', 'Orders', 'Value', 'Share']} />
      </LoadingSection>
    </>
  )
}

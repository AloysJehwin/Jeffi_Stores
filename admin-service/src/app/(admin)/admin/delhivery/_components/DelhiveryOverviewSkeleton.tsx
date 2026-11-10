import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Delhivery overview body while its data loads. */
export default function DelhiveryOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Shipments', 'Delivered', 'In transit now', 'Failed attempts (NDR)', 'RTO rate', 'Time in transit', 'On time', 'Freight per order', 'Freight billed', 'COD collected', 'COD remitted', 'Pickup requests']} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="Pickups not yet collected">
          <LoadingTable bare rows={4} columns={['Pickup date', 'Request', 'AWBs', 'Status', 'Raised']} />
        </LoadingSection>
      </div>
      <LoadingChart title="Shipped and delivered" />
      <LoadingSection title="Delivery time by zone">
        <LoadingTable bare rows={5} columns={['Zone', 'Delivered', 'Avg days', 'Promised', 'Within promise']} />
      </LoadingSection>
    </>
  )
}

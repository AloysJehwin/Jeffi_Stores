import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Suppliers overview body while its data loads. */
export default function SuppliersOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Purchases received', 'POs raised', 'Paid to suppliers', 'Open POs', 'On-time delivery', 'Avg lead time', 'Payables due', 'Active suppliers']} />
      <LoadingSection title="Needs attention" lines={3} />
      <LoadingChart title="Purchasing" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <LoadingSection title="Top suppliers">
            <LoadingTable bare rows={5} columns={['Supplier', 'Received', 'On time', 'Lead', 'Open POs', 'Payable']} />
          </LoadingSection>
        </div>
        <LoadingSection title="Late purchase orders" lines={4} />
      </div>
    </>
  )
}

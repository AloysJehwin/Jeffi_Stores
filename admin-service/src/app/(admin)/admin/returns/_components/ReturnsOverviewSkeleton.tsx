import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Returns overview body while its data loads. */
export default function ReturnsOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Return requests', 'Return rate', 'Value requested', 'Refunded', 'Time to close', 'Open now']} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="Open returns by stage" lines={5} />
      </div>
      <LoadingChart title="Return requests over time" height="h-48" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="By reason" lines={4} />
        <LoadingSection title="Inspected condition" lines={3} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Most returned products">
          <LoadingTable bare rows={4} columns={['Product', 'Requests', 'Units', 'Value']} />
        </LoadingSection>
        <LoadingSection title="Oldest open requests">
          <LoadingTable bare rows={4} columns={['Order', 'Customer', 'Reason', 'Status', 'Raised']} />
        </LoadingSection>
      </div>
    </>
  )
}

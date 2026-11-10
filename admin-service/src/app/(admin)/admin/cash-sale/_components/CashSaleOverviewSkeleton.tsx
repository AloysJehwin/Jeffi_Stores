import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Cash Sales overview body while its data loads. */
export default function CashSaleOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Sales today', 'Sales in period', 'Bills', 'Average bill', 'Per trading day', 'Units sold', 'GST collected', 'Cancelled']} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="By payment mode" lines={3} />
      </div>
      <LoadingChart title="Sales over time" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadingChart title="By hour of day (IST)" height="h-32" />
        <LoadingSection title="Top items">
          <LoadingTable bare rows={5} columns={['Item', 'Units', 'Bills', 'Sales']} />
        </LoadingSection>
      </div>
    </>
  )
}

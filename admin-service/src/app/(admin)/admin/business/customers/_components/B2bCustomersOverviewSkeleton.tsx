import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Business Customers overview body (below the period and filter bars) while its data loads. */
export default function B2bCustomersOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['B2B sales', 'B2B orders', 'Avg order', 'Active buyers', 'Approved accounts', 'New applications', 'Credit outstanding', 'Over 30 days']} />
      <LoadingSection title="Needs attention" lines={3} />
      <LoadingChart title="B2B sales" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LoadingSection title="Top B2B customers">
            <LoadingTable bare rows={5} columns={['Customer', 'Orders', 'Sales', 'Outstanding']} />
          </LoadingSection>
        </div>
        <LoadingSection title="Applications to review" lines={4} />
      </div>
    </>
  )
}

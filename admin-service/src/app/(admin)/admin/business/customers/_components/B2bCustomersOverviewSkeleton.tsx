import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'
import { SplitRow } from '@/components/admin/kit'

/** The Business Customers overview body (below the period and filter bars) while its data loads. */
export default function B2bCustomersOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['B2B sales', 'B2B orders', 'Avg order', 'Active buyers', 'Approved accounts', 'New applications', 'Credit outstanding', 'Over 30 days']} />
      <LoadingSection title="Needs attention" lines={3} />
      <LoadingChart title="B2B sales" />
      <SplitRow
        scroll="narrow"
        wide={
          <LoadingSection title="Top B2B customers">
            <LoadingTable bare rows={5} columns={['Customer', 'Orders', 'Sales', 'Outstanding']} />
          </LoadingSection>
        }
        narrow={
          <LoadingSection title="Applications to review" lines={4} />
        }
      />
    </>
  )
}

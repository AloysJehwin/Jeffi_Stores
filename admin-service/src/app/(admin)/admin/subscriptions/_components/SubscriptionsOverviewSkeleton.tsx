import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Subscriptions overview body (below the period and filter bars) while its data loads. */
export default function SubscriptionsOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Active', 'MRR', 'New', 'Cancelled', 'Churn', 'Net new', 'Billed', 'Renewals due (7 days)', 'Failed renewals', 'Ending at cycle end']} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="Failed renewals">
          <LoadingTable bare rows={4} columns={['Customer', 'Product', 'Status', 'Per cycle']} />
        </LoadingSection>
      </div>
      <LoadingChart title="Subscriptions over time" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <LoadingSection title="Renewals due in 7 days">
          <LoadingTable bare rows={4} columns={['Customer', 'Due', 'Amount']} />
        </LoadingSection>
        <LoadingSection title="MRR by product" lines={5} />
        <LoadingSection title="By plan" lines={4} />
      </div>
    </>
  )
}

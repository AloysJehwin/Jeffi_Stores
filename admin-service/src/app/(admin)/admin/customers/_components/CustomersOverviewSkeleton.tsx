import { LoadingKpis, LoadingSection } from '@/components/admin/kit/skeleton'

/** The Customers overview body while its data loads. */
export default function CustomersOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['New accounts', 'Active buyers', 'Repeat buyers', 'Account orders', 'Guest orders', 'Revenue']} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="Top states" lines={5} />
      </div>
    </>
  )
}

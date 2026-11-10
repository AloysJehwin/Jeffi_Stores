import { LoadingKpis } from '@/components/admin/kit/skeleton'
import { LoadingAttention, LoadingTableCard } from '../../products/_components/loading-parts'

/** The review forms overview body (below the period bar and filters) while its data loads. */
export default function ReviewFormsOverviewLoading() {
  return (
    <div className="space-y-4">
      <LoadingKpis labels={['Active forms', 'Submissions', 'Requests sent', 'Conversion', 'Approved', 'Coupons issued']} />
      <LoadingAttention />
      <LoadingTableCard title="Forms" columns={['Form', 'Reward', 'Submissions', 'Pending', 'Approved', 'All time']} />
    </div>
  )
}

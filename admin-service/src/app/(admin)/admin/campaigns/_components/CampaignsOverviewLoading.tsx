import { LoadingChart, LoadingKpis } from '@/components/admin/kit/skeleton'
import { LoadingAttention, LoadingTableCard } from '../../products/_components/loading-parts'

/** The campaigns overview body (below the period bar) while its data loads. */
export default function CampaignsOverviewLoading() {
  return (
    <div className="space-y-4">
      <LoadingKpis labels={['Sends', 'Open rate', 'Click rate', 'Conversions', 'Revenue', 'Unsubscribes']} />
      <LoadingAttention />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LoadingChart title="Sends and engagement" />
        </div>
        <LoadingTableCard title="By channel" columns={['Channel', 'Sends', 'Conv.', 'Revenue']} rows={4} />
      </div>
      <LoadingTableCard title="By campaign" columns={['Campaign', 'Sends', 'Push', 'Open', 'Click', 'Conv.', 'Revenue', 'Unsub.', 'Failed']} />
    </div>
  )
}

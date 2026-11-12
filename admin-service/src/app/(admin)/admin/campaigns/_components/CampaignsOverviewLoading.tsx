import { LoadingChart, LoadingKpis } from '@/components/admin/kit/skeleton'
import { LoadingAttention, LoadingTableCard } from '../../products/_components/loading-parts'
import { SplitRow } from '@/components/admin/kit'

/** The campaigns overview body (below the period bar) while its data loads. */
export default function CampaignsOverviewLoading() {
  return (
    <div className="space-y-4">
      <LoadingKpis labels={['Sends', 'Open rate', 'Click rate', 'Conversions', 'Revenue', 'Unsubscribes']} />
      <LoadingAttention />
      <SplitRow
        scroll="narrow"
        wide={
          <LoadingChart title="Sends and engagement" />
        }
        narrow={
          <LoadingTableCard title="By channel" columns={['Channel', 'Sends', 'Conv.', 'Revenue']} rows={4} />
        }
      />
      <LoadingTableCard title="By campaign" columns={['Campaign', 'Sends', 'Push', 'Open', 'Click', 'Conv.', 'Revenue', 'Unsub.', 'Failed']} />
    </div>
  )
}

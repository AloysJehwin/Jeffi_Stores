import { LoadingChart, LoadingKpis, LoadingSection, LoadingToolbar } from '@/components/admin/kit/skeleton'
import { LoadingAttention, LoadingPeriodBar, LoadingTableCard } from '../../../products/_components/loading-parts'
import { SplitRow } from '@/components/admin/kit'

/** MessagingOverview's body while its data loads. */
export function MessagingOverviewLoading() {
  return (
    <div className="space-y-4">
      <LoadingKpis labels={['Messages', 'Email', 'WhatsApp', 'Failed', 'Marketing cap (63049)', 'Spend']} />
      <LoadingAttention />
      <SplitRow
        scroll="narrow"
        wide={
          <LoadingChart title="Messages by channel" />
        }
        narrow={
          <LoadingSection title="Failure reasons" />
        }
      />
      <LoadingTableCard title="By channel and status" columns={['Channel', 'Total', 'Sent', 'Delivered', 'Failed', 'Spend']} rows={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingTableCard title="Broadcasts sent" columns={['Title', 'Template', 'Sent', 'Messages', 'Failed']} />
        <LoadingTableCard title="Templates used (WhatsApp and SMS)" columns={['Template', 'Channel', 'Sent', 'Failed', 'Spend']} />
      </div>
    </div>
  )
}

/** The whole Overview tab: period bar, filters, body. */
export function MessagingOverviewTabLoading() {
  return (
    <div className="space-y-4">
      <LoadingPeriodBar />
      <LoadingToolbar filters={1} />
      <MessagingOverviewLoading />
    </div>
  )
}

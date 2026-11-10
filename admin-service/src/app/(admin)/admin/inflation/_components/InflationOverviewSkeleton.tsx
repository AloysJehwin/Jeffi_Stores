import { LoadingOverviewBody, LoadingTableCard } from '../../products/_components/loading-parts'

/** Overview body while it loads: real KPI labels and the recent-runs table headings. Server-safe. */
export default function InflationOverviewSkeleton() {
  return (
    <LoadingOverviewBody
      kpis={['Price runs', 'Products affected', 'Average change', 'Rolled back', 'Last run', 'Not repriced']}
      panel={<LoadingTableCard title="Recent runs" columns={['Category', 'Change', 'Products', 'State', 'When']} />}
    />
  )
}

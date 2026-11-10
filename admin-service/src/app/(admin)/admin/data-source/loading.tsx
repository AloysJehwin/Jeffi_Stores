import { LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'
import DataSourceOverviewSkeleton from './_components/DataSourceOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading
      title="Data source"
      description="Bulk-import products from a spreadsheet, or sync them from a Google Sheet. New SKUs create products; existing SKUs update them, through the same publish path the editor uses."
    >
      <div className="space-y-4">
        <LoadingTabs tabs={['Overview', 'Import file', 'Google Sheet', 'History']} />
        <DataSourceOverviewSkeleton />
      </div>
    </PageLoading>
  )
}

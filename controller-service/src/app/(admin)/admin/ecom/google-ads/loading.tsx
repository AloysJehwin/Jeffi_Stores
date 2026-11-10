import { LoadingTable, Sk } from '@/components/admin/kit/skeleton'
import { GADS_COLUMNS } from './columns'

export default function Loading() {
  return (
    <div className="p-4 sm:p-6 w-full space-y-5" role="status" aria-busy="true" aria-label="Loading Google Ads accounts">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Google Ads accounts</h1>
          <Sk className="mt-2 h-3.5 w-96 max-w-full" />
        </div>
        <Sk className="h-control w-10 rounded-lg" />
      </div>
      <LoadingTable columns={GADS_COLUMNS} rows={5} />
    </div>
  )
}

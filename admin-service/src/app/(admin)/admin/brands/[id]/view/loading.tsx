import { LoadingKpis, LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingCard, LoadingEntitySplit, LoadingFields, LoadingRecentChanges } from '../../../products/_components/loading-parts'

export default function Loading() {
  return (
    <PageLoading back="Brands" actions={1}>
      <LoadingKpis labels={['Total products', 'Active products', 'Created']} />
      <LoadingEntitySplit
        main={
          <div className="min-w-0 rounded-xl border border-border-default bg-surface-elevated">
            <h2 className="px-5 pb-3 pt-4 text-sm font-semibold uppercase tracking-wide text-foreground">Products</h2>
            <LoadingTable columns={['Product', 'SKU', 'Price', 'Status']} bare />
          </div>
        }
        aside={
          <>
            <LoadingCard title="Brand details">
              <LoadingFields cols={1} labels={['Slug', 'Website', 'Logo', 'Returns', 'Replacement']} />
            </LoadingCard>
            <LoadingRecentChanges />
          </>
        }
      />
    </PageLoading>
  )
}

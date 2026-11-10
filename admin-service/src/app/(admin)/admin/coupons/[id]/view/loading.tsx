import { LoadingKpis, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingCard, LoadingEntitySplit, LoadingFields, LoadingRecentChanges, LoadingTableCard } from '../../../products/_components/loading-parts'

export default function Loading() {
  return (
    <PageLoading back="Coupons" actions={1}>
      <LoadingKpis labels={['Times used', 'Total discount given', 'Eligible users', 'Discount']} />
      <LoadingEntitySplit
        main={
          <>
            <LoadingTableCard title="Usage history" columns={['User', 'Order', 'Discount', 'Date']} />
            <LoadingTableCard title="Eligible Users" columns={['User', 'Added At', 'Used']} rows={4} />
          </>
        }
        aside={
          <>
            <LoadingCard title="Coupon details">
              <LoadingFields
                cols={1}
                labels={['Type', 'Value', 'Min Purchase', 'Max Discount', 'Usage Limit', 'Per-User Limit', 'Valid From', 'Valid Until', 'Auto Generated', 'Source']}
              />
            </LoadingCard>
            <LoadingRecentChanges />
          </>
        }
      />
    </PageLoading>
  )
}

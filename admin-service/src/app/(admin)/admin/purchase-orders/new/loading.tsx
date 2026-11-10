import { LoadingForm, LoadingSection, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Purchase orders" title="New Purchase Order" description="Create a new PO for a supplier">
      <LoadingForm sections={[{ title: 'Order Details', fields: ['Supplier', 'Order Date', 'Expected Date', 'Status', 'Notes'] }]} footer={false} />
      <LoadingSection title="Line Items" lines={3} />
    </PageLoading>
  )
}

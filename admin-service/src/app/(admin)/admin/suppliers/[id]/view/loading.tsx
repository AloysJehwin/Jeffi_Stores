import { LoadingFacts, LoadingSection, LoadingTable, LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Suppliers" actions={2}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <LoadingSection title="Contact">
          <LoadingFacts labels={['Contact', 'Phone', 'Email', 'Address']} />
        </LoadingSection>
        <LoadingSection title="GST & Payment">
          <LoadingFacts labels={['GSTIN', 'Payment Terms', 'Bank', 'Account', 'IFSC', 'UPI']} />
        </LoadingSection>
        <LoadingSection title="Summary">
          <LoadingFacts labels={['Total POs', 'PO Value', 'Total Bills', 'Bills Value']} />
        </LoadingSection>
      </div>
      <div className="space-y-4">
        <LoadingTabs tabs={['Purchase Orders', 'Bills / Expenses', 'Products', 'Change log']} />
        <LoadingTable columns={['PO #', 'Date', 'Expected', 'Status', 'Amount']} rows={6} />
      </div>
    </PageLoading>
  )
}

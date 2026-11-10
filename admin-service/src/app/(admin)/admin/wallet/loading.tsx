import { LoadingKpis, LoadingSection, LoadingTable, PageLoading, Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading
      title="Shipping Wallet"
      description="Prepaid balance the platform debits for Delhivery charges (forward shipments, return pickups, corrections), messaging and AI."
    >
      <LoadingKpis labels={['Balance', 'Credits', 'Debits']} />
      <LoadingSection title="Top up">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40 space-y-1.5">
            <p className="text-sm font-medium text-foreground-secondary">Amount (₹)</p>
            <Sk className="h-control rounded-lg" />
          </div>
          <Sk className="h-control w-24 rounded-lg" />
        </div>
      </LoadingSection>
      <LoadingSection title="Ledger">
        <LoadingTable bare toolbar={2} columns={['Date', 'Category', 'Reference', 'Amount']} />
      </LoadingSection>
    </PageLoading>
  )
}

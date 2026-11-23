import { ConsoleLoading, FinanceTableLoading, TilesLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Finance" title="Settlement ledger" description="Your store's sales money: captured payments, fees, refunds and payouts to your bank. Your prepaid wallet is separate.">
      <div className="space-y-6">
        <TilesLoading labels={['Settlement balance', 'Gross GMV', 'Your earnings', 'Platform fees']} />
        <FinanceTableLoading columns={['Date', 'Type', 'Amount', 'Note']} minWidth="min-w-[500px]" />
      </div>
    </ConsoleLoading>
  )
}

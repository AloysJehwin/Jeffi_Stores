import { ConsoleLoading, FinanceTableLoading, TilesLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Finance" title="Settlement ledger" description="Captures, commissions, payouts and adjustments on your wallet.">
      <div className="space-y-6">
        <TilesLoading labels={['Wallet balance', 'Gross GMV', 'Your earnings', 'Platform fees']} />
        <FinanceTableLoading columns={['Date', 'Type', 'Amount', 'Note']} minWidth="min-w-[500px]" />
      </div>
    </ConsoleLoading>
  )
}

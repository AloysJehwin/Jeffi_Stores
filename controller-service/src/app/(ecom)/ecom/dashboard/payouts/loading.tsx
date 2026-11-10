import { ConsoleLoading, FinanceTableLoading, LinesLoading, PillLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Finance" title="Payouts" description="Where your sales settle. Changes here are sent to the payment provider straight away.">
      <div className="max-w-xl">
        <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground mb-2">Settlement account</p>
              <LinesLoading lines={2} />
            </div>
            <PillLoading className="w-24" />
          </div>
        </div>
      </div>
      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Recent payouts</h2>
        <FinanceTableLoading columns={['Paid on', 'Amount', 'Fees', 'Bank reference (UTR)', 'Status']} rows={5} minWidth="min-w-[500px]" />
      </div>
    </ConsoleLoading>
  )
}

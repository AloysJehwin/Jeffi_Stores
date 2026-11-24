import { CardLoading, ConsoleLoading, LinesLoading, PillLoading, SandTableLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Finance" title="Payouts" description="Where your sales settle. Changes here are sent to the payment provider straight away.">
      <div className="space-y-6">
        <section className="rounded-2xl border border-border-default bg-surface-elevated p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Settlement account</h2>
            <PillLoading className="w-24" />
          </div>
          <LinesLoading lines={2} />
        </section>
        <CardLoading title="Recent payouts">
          <SandTableLoading columns={['Paid on', 'Amount', 'Fees', 'Bank reference (UTR)', 'Status']} rows={5} minWidth="min-w-[500px]" />
        </CardLoading>
      </div>
    </ConsoleLoading>
  )
}

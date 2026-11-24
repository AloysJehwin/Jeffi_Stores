import { Check } from 'lucide-react'
import { CardLoading, ConsoleLoading, SandTableLoading, Sk, TilesLoading } from '../_components/Skeleton'
import { fmtWhole } from '../_components/finance'
import { primaryBtn } from '../../onboard/ui'
import { topupAmounts } from '@/lib/billing/topup-amounts'

const AMOUNTS = [500, 1000, 2500, 5000]

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Finance" title="Wallet" description="One prepaid balance for messaging, documents and shipping.">
      <div className="space-y-6">
        <TilesLoading labels={['Balance', 'Spent today', 'Last top-up']} cols="grid-cols-2 sm:grid-cols-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1" />
        <CardLoading title="Top up">
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Amount</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-2">
                  {AMOUNTS.map(a => (
                    <span key={a} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${a === 1000 ? 'ecom-sel border-transparent' : 'border-border-secondary text-foreground-secondary'}`}>
                      {a === 1000 && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      {fmtWhole(a)}
                    </span>
                  ))}
                </div>
                <Sk className="h-control w-32 rounded-xl" />
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-border-default pt-4 sm:flex-row sm:items-center sm:justify-between">
              <Sk className="h-3.5 w-72 max-w-full" />
              <span className={`${primaryBtn} w-full opacity-60 sm:w-auto`}>Pay {fmtWhole(topupAmounts(1000).total)}</span>
            </div>
          </div>
        </CardLoading>
        <CardLoading title="Wallet activity">
          <div className="-mx-6 -mb-6 divide-y divide-border-default border-t border-border-default sm:hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-6 py-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Sk className="h-3.5 w-32" />
                  <Sk className="h-3 w-44 max-w-full" />
                </div>
                <Sk className="h-3.5 w-16" />
              </div>
            ))}
          </div>
          <SandTableLoading columns={['Date', 'Type', 'Note', 'Amount']} rows={8} minWidth="min-w-[560px]" edge="-mx-6 -mb-6 hidden sm:block" />
        </CardLoading>
      </div>
    </ConsoleLoading>
  )
}

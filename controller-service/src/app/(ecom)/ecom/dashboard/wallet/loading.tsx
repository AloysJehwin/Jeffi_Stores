import { Check } from 'lucide-react'
import { CardLoading, ConsoleLoading, SandTableLoading, Sk, TilesLoading } from '../_components/Skeleton'

const AMOUNTS = ['₹500.00', '₹1,000.00', '₹2,500.00', '₹5,000.00']

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Finance" title="Wallet" description="One prepaid balance for messaging, documents and shipping. Shared with your store admin.">
      <div className="space-y-6">
        <TilesLoading labels={['Balance', 'Spent today', 'Entries']} sand cols="grid-cols-2 lg:grid-cols-3" />
        <CardLoading title="Top up">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {AMOUNTS.map((a, i) => (
                <span key={a} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${i === 1 ? 'ecom-sel border-transparent' : 'border-border-secondary text-foreground-secondary'}`}>
                  {i === 1 && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  {a}
                </span>
              ))}
            </div>
            <Sk className="h-9 w-32 rounded-xl" />
            <span className="ecom-accent-bg rounded-full px-5 py-2 text-sm font-semibold text-white opacity-60">Pay with Razorpay</span>
          </div>
        </CardLoading>
        <CardLoading title="Ledger">
          <SandTableLoading columns={['When', 'Category', 'Amount', 'Note']} rows={8} minWidth="min-w-[560px]" />
        </CardLoading>
      </div>
    </ConsoleLoading>
  )
}

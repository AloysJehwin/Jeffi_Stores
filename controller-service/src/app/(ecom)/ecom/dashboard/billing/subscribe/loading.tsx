import { ConsoleLoading, LinesLoading, Sk } from '../../_components/Skeleton'

const box = 'rounded-2xl border border-border-default bg-surface-elevated p-6'
const h2 = 'text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4'

export default function Loading() {
  return (
    <ConsoleLoading
      eyebrow="Account"
      title="Set up your subscription"
      description="Your monthly charges move from the wallet to one Razorpay subscription: one payment a month, one approval."
    >
      <div className="space-y-6">
        <div className={box}>
          <h2 className={h2}>On your subscription</h2>
          <LinesLoading lines={3} />
        </div>
        <div className={box}>
          <h2 className={h2}>How it works</h2>
          <LinesLoading lines={4} />
        </div>
        <Sk className="h-10 w-48 rounded-xl" />
      </div>
    </ConsoleLoading>
  )
}

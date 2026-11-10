import { ConsoleLoading, LinesLoading, PillLoading, Sk } from '../_components/Skeleton'

const box = 'rounded-2xl border border-border-default bg-surface-elevated p-6'
const h2 = 'text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Account" title="Billing" description="Your plan, renewal, add-ons and subscription controls.">
      <div className="space-y-8">
        <div className={box}>
          <h2 className={h2}>Ads on your store</h2>
          <LinesLoading lines={2} />
          <Sk className="mt-4 h-9 w-48 rounded-xl" />
        </div>
        <div className={box}>
          <h2 className={h2}>Current subscription</h2>
          <div className="flex flex-wrap items-center gap-4">
            <div className="space-y-2">
              <Sk className="h-7 w-36" />
              <Sk className="h-3.5 w-28" />
            </div>
            <PillLoading />
          </div>
          <Sk className="mt-4 h-3.5 w-2/3" />
          <p className="mt-4 text-sm text-foreground-secondary">
            Change your plan or server size on <span className="underline">Plan &amp; servers</span>.
          </p>
        </div>
      </div>
    </ConsoleLoading>
  )
}

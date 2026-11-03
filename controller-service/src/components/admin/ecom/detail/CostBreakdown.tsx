import type { InfraDetail } from '@controller/lib/ecom/detail'
import { Section } from '../EcomUI'
import { inr } from '../cells'

/** Each priced part of the spec: AWS's cost beside the owner's price at the plan's margin, then the monthly total. */
export default function CostBreakdown({ infra }: { infra: InfraDetail }) {
  const b = infra.breakdown
  return (
    <Section title="Cost breakdown">
      {!b ? (
        <p className="text-sm text-foreground-muted">{infra.breakdownNote}</p>
      ) : (
        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 sm:gap-x-6 text-sm">
            <span className="text-xs text-foreground-muted">Part</span>
            <span className="text-xs text-foreground-muted text-right">AWS /mo</span>
            <span className="text-xs text-foreground-muted text-right">Price /mo</span>
            {b.quote.lines.map(l => (
              <div key={l.key} className="contents">
                <div className="min-w-0 border-t border-border-default py-2">
                  <p className="text-foreground">{l.label}</p>
                  <p className="text-xs text-foreground-muted break-words">{l.detail}</p>
                </div>
                <span className="border-t border-border-default py-2 text-right tabular-nums text-foreground-secondary">{inr(l.awsUsdMonth * b.usdInr)}</span>
                <span className="border-t border-border-default py-2 text-right tabular-nums text-foreground">{inr(l.inrMonth)}</span>
              </div>
            ))}
            <span className="border-t border-border-default pt-2 font-semibold text-foreground">Infrastructure</span>
            <span className="border-t border-border-default pt-2 text-right font-semibold tabular-nums text-foreground-secondary">{inr(b.quote.awsInrMonth)}</span>
            <span className="border-t border-border-default pt-2 text-right font-semibold tabular-nums text-foreground">{inr(b.quote.inrMonth)}</span>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-surface-secondary/60 p-3 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">Margin</dt>
              <dd className="tabular-nums text-green-600 dark:text-green-400">
                {inr(b.quote.marginInrMonth)} <span className="text-xs text-foreground-muted">({Math.round(b.margin * 100)}%)</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">GST on infra</dt>
              <dd className="tabular-nums text-foreground">{inr(b.total.gstOnInfra)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">Plan fee</dt>
              <dd className="tabular-nums text-foreground">{inr(b.total.planFee)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">Owner pays / mo</dt>
              <dd className="font-semibold tabular-nums text-foreground">{inr(b.total.total)}</dd>
            </div>
          </dl>
          <p className="text-xs text-foreground-muted">At today&apos;s catalog prices and ₹{b.usdInr}/USD. The subscription charges the price stored when the spec was chosen.</p>
        </div>
      )}
    </Section>
  )
}

import { Field } from '@/components/admin/kit'
import { FieldGrid, Row } from './CollapsibleCard'
import { formatINR } from '@/lib/shared/format'
import { deriveSellableItems, monthlyEquivalentLabel, pickSubscriptionPrice, subscriptionSavingsPct } from '@/lib/subscriptions/sellable'
import { SUBSCRIPTION_INTERVALS, SUBSCRIPTION_INTERVAL_LABELS, isSubscriptionInterval } from '@/lib/subscriptions/intervals'
import { variantSubsShown } from './product-view'

export function SubscriptionDetails({ p, variants }: { p: any; variants: any[] }) {
  const intervals: string[] = Array.isArray(p.subscription_intervals) ? p.subscription_intervals : []
  const offered = SUBSCRIPTION_INTERVALS.filter(i => intervals.includes(i))
  const subsByVariant: Record<string, any[]> = {}
  for (const v of variants) subsByVariant[String(v.id)] = variantSubsShown(v)
  const items = deriveSellableItems({
    hasVariants: !!p.has_variants,
    product: {
      name: p.name,
      sku: p.sku,
      price: p.base_price,
      subscription_price: p.subscription_price,
      subscription_prices: p.subscription_prices,
    },
    variants: variants.map(v => ({
      ...v,
      sub_variant_type_on: variantSubsShown(v).length > 0,
    })),
    subVariantsByVariant: subsByVariant,
  })
  return (
    <div className="space-y-3">
      <FieldGrid>
        <Row
          label="Billing Intervals"
          wide
          value={intervals.map(i => (isSubscriptionInterval(i) ? SUBSCRIPTION_INTERVAL_LABELS[i] : i)).join(', ') || '—'}
        />
        <Field label="Billing Cycles" value={p.subscription_total_cycles ?? 'Until cancelled'} />
        <Field label="Minimum Billing Cycles" value={p.subscription_min_cycles ?? '—'} />
      </FieldGrid>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-foreground-muted">
              <th className="py-1.5 pr-2 text-left font-semibold">Item</th>
              <th className="py-1.5 px-2 text-right font-semibold">One-time</th>
              {offered.map(iv => (
                <th key={iv} className="py-1.5 px-2 text-right font-semibold">
                  {SUBSCRIPTION_INTERVAL_LABELS[iv]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {items.map(it => (
              <tr key={it.key}>
                <td className="py-1.5 pr-2 text-foreground">
                  {it.name}
                  {it.sku && <span className="block font-mono text-[10px] text-foreground-muted">{it.sku}</span>}
                </td>
                <td className="py-1.5 px-2 text-right text-foreground">{it.oneTimePrice != null ? formatINR(it.oneTimePrice) : '—'}</td>
                {offered.map(iv => {
                  const sub = pickSubscriptionPrice(it.subscriptionPrices, it.subscriptionPrice, iv)
                  const pct = sub != null && it.oneTimePrice != null ? subscriptionSavingsPct(it.oneTimePrice, sub) : 0
                  const perMonth = sub != null ? monthlyEquivalentLabel(iv, sub) : null
                  return (
                    <td key={iv} className="py-1.5 px-2 text-right text-foreground" data-testid={`sub-price-${iv}`}>
                      {sub != null ? formatINR(sub) : <span className="text-foreground-muted">Same as one-time</span>}
                      {(perMonth || pct > 0) && (
                        <span className="block text-[10px] text-foreground-muted">
                          {[perMonth, pct > 0 ? `${pct}% off` : null].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

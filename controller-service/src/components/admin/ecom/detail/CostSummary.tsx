import Link from 'next/link'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import { Field, FieldGrid, Section } from '../EcomUI'
import { inr, inrHr } from '../cells'
import { detailHref } from './labels'

/** Price to the owner, AWS's bill, Jeffi's margin and this month so far. */
export default function CostSummary({ d }: { d: TenantDetailData }) {
  const { cost, row } = d
  const price = row?.price_inr_month ?? cost.priceMonth
  return (
    <Section
      title="Cost"
      action={
        <Link href={detailHref(d.t.id, 'instance')} className="text-sm text-accent-600 hover:underline">
          Breakdown →
        </Link>
      }
    >
      {cost.priceHour == null && price == null ? (
        <p className="text-sm text-foreground-muted">No compute has been applied yet, so there is nothing to price.</p>
      ) : (
        <FieldGrid>
          <Field label="Price / month" value={<span className="tabular-nums">{price == null ? '—' : inr(price)}</span>} />
          <Field label="Infra rate" value={<span className="tabular-nums">{inrHr(cost.priceHour)}</span>} />
          <Field label="AWS / month" value={<span className="tabular-nums">{inr(cost.awsMonth)}</span>} />
          <Field label="Margin / month" value={<span className="tabular-nums text-green-600 dark:text-green-400">{inr(cost.marginMonth)}</span>} />
          <Field label="This month so far" value={<span className="tabular-nums">{cost.mtdEstimate == null ? '—' : `${inr(cost.mtdEstimate)} est.`}</span>} />
          <Field label="Compute" value={<span className="capitalize">{row?.compute_status ?? '—'}</span>} />
        </FieldGrid>
      )}
    </Section>
  )
}

import Link from 'next/link'
import type { TenantDetail } from '@/lib/tenant-registry'
import { Field, Section } from '../EcomUI'

type Billing = Awaited<ReturnType<typeof import('@/lib/tenant-registry').getTenantBilling>> | null

export default function CommerceTab({ tenant: t, billing }: { tenant: TenantDetail; billing: Billing }) {
  if (!billing) {
    return (
      <Section title="Commerce">
        <p className="text-sm text-foreground-muted">
          No billing activity recorded for this store yet.
        </p>
      </Section>
    )
  }

  return (
    <Section
      title="Billing snapshot"
      action={
        <Link href={`/admin/ecom/billing/${t.id}`} className="text-sm text-accent-600 dark:text-accent-400 hover:underline">
          View full billing →
        </Link>
      }
    >
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 min-w-0">
        <Field
          label="Settlement balance"
          value={<span className={billing.balance >= 0 ? 'text-green-600' : 'text-red-600'}>₹{billing.balance.toLocaleString('en-IN')}</span>}
        />
        <Field label="GMV" value={`₹${billing.totals.gross.toLocaleString('en-IN')}`} />
        <Field label="Your commission" value={`₹${billing.totals.commission.toLocaleString('en-IN')}`} />
        <Field label="Transactions" value={billing.transactions.length} />
      </dl>
    </Section>
  )
}

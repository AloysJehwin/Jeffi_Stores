import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { getTenantBilling } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import { TransactionsTable } from '../_components/finance'

export const dynamic = 'force-dynamic'

export default async function TransactionsPage() {
  const { tenant } = await loadOwnerContext()
  const billing = await getTenantBilling(tenant.id)
  return (
    <>
      <PageHeader eyebrow="Finance" title="Transactions" description="Every captured order, with your share and platform fees." />
      <TransactionsTable transactions={billing.transactions} totals={billing.totals} />
    </>
  )
}

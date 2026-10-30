import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getTenantBilling } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import { TransactionsTable } from '../_components/finance'
import { PageLinks, PAGE_SIZE, pageParam } from '../_components/Pagination'

export const dynamic = 'force-dynamic'

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { tenant } = await loadOwnerContext()
  const billing = await getTenantBilling(tenant.id)
  const page = pageParam((await searchParams).page, Math.ceil(billing.transactions.length / PAGE_SIZE))
  return (
    <>
      <PageHeader eyebrow="Finance" title="Transactions" description="Every captured order, with your share and platform fees." />
      <TransactionsTable transactions={billing.transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} totals={billing.totals} />
      <PageLinks page={page} total={billing.transactions.length} base="/dashboard/transactions" />
    </>
  )
}

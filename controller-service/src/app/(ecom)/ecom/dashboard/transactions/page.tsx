import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getTenantBilling } from '@/lib/tenant-registry'
import { Receipt } from 'lucide-react'
import PageHeader from '../_components/PageHeader'
import { EmptyState } from '../_components/EmptyState'
import { TransactionsTable, salesNextStep } from '../_components/finance'
import { PageLinks, PAGE_SIZE, pageParam } from '../_components/Pagination'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Transactions' }

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { tenant } = await loadOwnerContext()
  const want = pageParam((await searchParams).page, Number.MAX_SAFE_INTEGER)
  const load = (p: number) => getTenantBilling(tenant.id, { transactions: { limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE }, ledger: { limit: 0 } })
  let billing = await load(want)
  const page = pageParam(String(want), Math.ceil(billing.transactionCount / PAGE_SIZE))
  if (page !== want) billing = await load(page)
  return (
    <>
      <PageHeader eyebrow="Finance" title="Transactions" description="Every captured order, with your share and platform fees." />
      <TransactionsTable
        transactions={billing.transactions}
        totals={billing.totals}
        empty={
          <EmptyState icon={Receipt} title="No transactions yet" action={salesNextStep(tenant)}>
            Each paid order shows here with your share, the platform commission and the gateway fee.
          </EmptyState>
        }
      />
      <PageLinks page={page} total={billing.transactionCount} base="/dashboard/transactions" />
    </>
  )
}

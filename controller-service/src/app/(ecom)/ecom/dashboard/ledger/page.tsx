import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getTenantBilling } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import { LedgerTable, MoneyTiles } from '../_components/finance'
import { PageLinks, PAGE_SIZE, pageParam } from '../_components/Pagination'

export const dynamic = 'force-dynamic'

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { tenant } = await loadOwnerContext()
  const want = pageParam((await searchParams).page, Number.MAX_SAFE_INTEGER)
  const load = (p: number) => getTenantBilling(tenant.id, { ledger: { limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE }, transactions: { limit: 0 } })
  let billing = await load(want)
  const page = pageParam(String(want), Math.ceil(billing.ledgerCount / PAGE_SIZE))
  if (page !== want) billing = await load(page)
  return (
    <>
      <PageHeader eyebrow="Finance" title="Settlement ledger" description="Captures, commissions, payouts and adjustments on your wallet." />
      <div className="space-y-6">
        <MoneyTiles balance={billing.balance} totals={billing.totals} />
        <div>
          <LedgerTable ledger={billing.ledger} balance={billing.balance} />
          <PageLinks page={page} total={billing.ledgerCount} base="/dashboard/ledger" />
        </div>
      </div>
    </>
  )
}

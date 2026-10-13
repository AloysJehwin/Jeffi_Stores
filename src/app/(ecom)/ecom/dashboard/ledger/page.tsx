import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { getTenantBilling } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import { LedgerTable, MoneyTiles } from '../_components/finance'
import { PageLinks, PAGE_SIZE, pageParam } from '../_components/Pagination'

export const dynamic = 'force-dynamic'

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { tenant } = await loadOwnerContext()
  const billing = await getTenantBilling(tenant.id)
  const page = pageParam((await searchParams).page, Math.ceil(billing.ledger.length / PAGE_SIZE))
  return (
    <>
      <PageHeader eyebrow="Finance" title="Settlement ledger" description="Captures, commissions, payouts and adjustments on your wallet." />
      <div className="space-y-6">
        <MoneyTiles balance={billing.balance} totals={billing.totals} />
        <div>
          <LedgerTable ledger={billing.ledger.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} balance={billing.balance} />
          <PageLinks page={page} total={billing.ledger.length} base="/dashboard/ledger" />
        </div>
      </div>
    </>
  )
}

import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { getTenantBilling } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import { LedgerTable, MoneyTiles } from '../_components/finance'

export const dynamic = 'force-dynamic'

export default async function LedgerPage() {
  const { tenant } = await loadOwnerContext()
  const billing = await getTenantBilling(tenant.id)
  return (
    <>
      <PageHeader eyebrow="Finance" title="Settlement ledger" description="Captures, commissions, payouts and adjustments on your wallet." />
      <div className="space-y-6">
        <MoneyTiles balance={billing.balance} totals={billing.totals} />
        <LedgerTable ledger={billing.ledger} balance={billing.balance} />
      </div>
    </>
  )
}

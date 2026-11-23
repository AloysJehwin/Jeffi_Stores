import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getOwnerBankWithRoute, listLinkedPayouts } from '@/lib/tenant-registry'
import { Landmark } from 'lucide-react'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import { EmptyState } from '../_components/EmptyState'
import { PayoutsTable } from '../_components/finance'
import PayoutsClient, { type BankState } from './PayoutsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Payouts' }

export default async function PayoutsPage() {
  const { owner, tenant } = await loadOwnerContext()
  const hasStore = (tenant.service_types ?? ['store']).includes('store')
  const [bank, payouts] = await Promise.all([
    getOwnerBankWithRoute(owner.id).catch(() => null),
    listLinkedPayouts(tenant.id).catch(() => []),
  ])
  // Only the last four digits leave the server.
  const initial: BankState | null =
    bank && bank.accountNumber
      ? {
          last4: bank.accountNumber.slice(-4),
          ifsc: bank.ifsc,
          holderName: bank.holderName,
          verifiedName: bank.verifiedName,
          verificationStatus: bank.verificationStatus,
          verificationRef: bank.verificationRef,
          hasRouteAccount: !!bank.linkedAccountId,
          upiId: bank.upiId,
        }
      : null

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Payouts"
        description="Where your sales settle. Changes here are sent to the payment provider straight away."
      />
      <div className="space-y-6">
        <PayoutsClient initial={initial} hasStore={hasStore} />
        <Card title="Recent payouts">
          <PayoutsTable
            payouts={payouts}
            empty={
              <EmptyState
                bare
                icon={Landmark}
                title="No payouts yet"
                action={hasStore ? { href: '/dashboard/transactions', label: 'View transactions' } : { href: '/dashboard/add-store', label: 'Add a store' }}
              >
                {hasStore ? 'Sales are paid out once the payment provider settles them.' : 'Payouts start once you add a store and it sells.'}
              </EmptyState>
            }
          />
        </Card>
      </div>
    </>
  )
}

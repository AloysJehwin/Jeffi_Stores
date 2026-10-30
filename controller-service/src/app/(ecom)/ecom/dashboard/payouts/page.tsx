import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getOwnerBankWithRoute, listLinkedPayouts } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import { PayoutsTable } from '../_components/finance'
import PayoutsClient, { type BankState } from './PayoutsClient'

export const dynamic = 'force-dynamic'

export default async function PayoutsPage() {
  const { owner, tenant } = await loadOwnerContext()
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
        }
      : null

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Payouts"
        description="Where your sales settle. Changes here are sent to the payment provider straight away."
      />
      <PayoutsClient initial={initial} />
      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Recent payouts</h2>
        <PayoutsTable payouts={payouts} />
      </div>
    </>
  )
}

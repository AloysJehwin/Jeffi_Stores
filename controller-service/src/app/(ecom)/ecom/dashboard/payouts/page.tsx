import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { getOwnerBankWithRoute } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import PayoutsClient, { type BankState } from './PayoutsClient'

export const dynamic = 'force-dynamic'

export default async function PayoutsPage() {
  const { owner } = await loadOwnerContext()
  const bank = await getOwnerBankWithRoute(owner.id).catch(() => null)
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
    </>
  )
}

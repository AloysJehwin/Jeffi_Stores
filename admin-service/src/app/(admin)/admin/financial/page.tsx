import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import FinancialClient from './FinancialClient'

export const dynamic = 'force-dynamic'

export default async function FinancialPage() {
  // Route stores are paid out by transfer; only the platform and own-key accounts have settlements.
  const account = await razorpayAccountFor().catch(() => null)

  return (
    <PageBody>
      <PageHeader title="Financial" description="Receivables, payables, P&L and cashflow" />
      <FinancialClient
        razorpayTab={account && (account.kind !== 'route' || account.ownFlag) ? { settlements: account.kind !== 'route' } : null}
      />
    </PageBody>
  )
}

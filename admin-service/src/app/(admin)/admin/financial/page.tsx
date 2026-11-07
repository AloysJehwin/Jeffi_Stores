import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import FinancialClient from './FinancialClient'

export const dynamic = 'force-dynamic'

export default async function FinancialPage() {
  // Route stores see their share and payouts; the platform and own-key accounts their Razorpay settlements.
  const account = await razorpayAccountFor().catch(() => null)

  return (
    <PageBody>
      <PageHeader title="Financial" description="Receivables, payables, P&L and cashflow" />
      <FinancialClient
        razorpayTab={account ? { route: account.kind === 'route', ownPending: account.kind === 'route' && account.ownFlag } : null}
      />
    </PageBody>
  )
}

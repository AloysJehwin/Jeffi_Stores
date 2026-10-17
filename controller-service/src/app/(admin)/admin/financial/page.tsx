import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import FinancialClient from './FinancialClient'

export const dynamic = 'force-dynamic'

export default function FinancialPage() {
  return (
    <PageBody>
      <PageHeader title="Financial" description="Receivables, payables, P&L and cashflow" />
      <FinancialClient />
    </PageBody>
  )
}

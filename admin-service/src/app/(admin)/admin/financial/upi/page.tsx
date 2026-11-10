import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import UpiConfirmationsClient from './UpiConfirmationsClient'

export const dynamic = 'force-dynamic'

export default async function UpiConfirmationsPage() {
  const host = await getHost()
  return (
    <PageBody>
      <PageHeader
        title="UPI confirmations"
        description="Payments customers made to your UPI ID. Check the UTR against your bank statement, then approve or reject."
        back={{ href: ap('/admin/financial', host), label: 'Financial' }}
      />
      <UpiConfirmationsClient />
    </PageBody>
  )
}

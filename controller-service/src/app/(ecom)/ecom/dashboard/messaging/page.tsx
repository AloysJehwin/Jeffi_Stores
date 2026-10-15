import { priceList } from '@jeffi/pricing'
import { getTenantWallet } from '@/lib/payments/wallet'
import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { hasService } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import MessagingClient from './MessagingClient'

export const dynamic = 'force-dynamic'

export default async function MessagingPage() {
  const { tenant } = await loadOwnerContext()
  const wallet = hasService(tenant, 'messaging') ? await getTenantWallet(tenant.id, 0).catch(() => null) : null
  return (
    <>
      <PageHeader eyebrow="Developers" title="Messaging" description="Templates, bulk sends and the delivery log for email, SMS and WhatsApp sent through your API keys." />
      {hasService(tenant, 'messaging') ? <MessagingClient prices={{ ...priceList().messages, media: priceList().media }} balance={Number(wallet?.balance ?? 0)} /> : <p className="text-sm text-foreground-secondary">Messaging is not enabled. Turn it on from API keys.</p>}
    </>
  )
}

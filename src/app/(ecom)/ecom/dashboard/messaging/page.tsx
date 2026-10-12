import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { hasService } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import MessagingClient from './MessagingClient'

export const dynamic = 'force-dynamic'

export default async function MessagingPage() {
  const { tenant } = await loadOwnerContext()
  return (
    <>
      <PageHeader eyebrow="Developers" title="Messaging" description="Templates and the delivery log for email, SMS and WhatsApp sent through your API keys." />
      {hasService(tenant, 'messaging') ? <MessagingClient /> : <p className="text-sm text-foreground-secondary">Messaging is not enabled. Turn it on from API keys.</p>}
    </>
  )
}

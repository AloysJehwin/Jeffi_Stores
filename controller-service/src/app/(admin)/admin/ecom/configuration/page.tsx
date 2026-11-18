import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import { TabActionsHost, TabLinks } from '@/components/admin/kit/core'
import ProvidersCard from '@/components/admin/site-controls/ProvidersCard'
import ServerPricingClient from './ServerPricingClient'
import MessagingAddonPricingClient from './MessagingAddonPricingClient'
import MessagePricingClient from './MessagePricingClient'

export const dynamic = 'force-dynamic'

const TABS = [
  { id: 'pricing', label: 'Server pricing', href: '/admin/ecom/configuration' },
  { id: 'messaging', label: 'SMS & WhatsApp add-on', href: '/admin/ecom/configuration?tab=messaging' },
  { id: 'message-pricing', label: 'Message pricing', href: '/admin/ecom/configuration?tab=message-pricing' },
  { id: 'overrides', label: 'Provider overrides', href: '/admin/ecom/configuration?tab=overrides' },
] as const
type Tab = (typeof TABS)[number]['id']

export default async function ConfigurationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const h = await headers()
  if (h.get('x-tenant-id')) notFound()
  if (!isPlatformAdmin(h.get('x-user-role') || '')) redirect('/admin')
  const { tab: raw } = await searchParams
  // The platform default moved to Settings → Providers; only the store overrides stay here.
  if (raw === 'providers') redirect(ap('/admin/settings?tab=providers', await getHost()))
  const tab: Tab = raw === 'messaging' || raw === 'message-pricing' || raw === 'overrides' ? raw : 'pricing'
  return (
    <PageBody>
      <PageHeader
        title="Configuration"
        description="Server pricing and margins, the SMS & WhatsApp add-on fee, message pricing and the stores that use their own providers."
      />
      {tab === 'overrides' ? (
        // The card's Add override button sits on this tab line.
        <TabActionsHost>
          <TabLinks tabs={TABS} value={tab} replace />
          <ProvidersCard view="overrides" />
        </TabActionsHost>
      ) : (
        <>
          <TabLinks tabs={TABS} value={tab} replace />
          {tab === 'pricing' ? <ServerPricingClient /> : tab === 'messaging' ? <MessagingAddonPricingClient /> : <MessagePricingClient />}
        </>
      )}
    </PageBody>
  )
}

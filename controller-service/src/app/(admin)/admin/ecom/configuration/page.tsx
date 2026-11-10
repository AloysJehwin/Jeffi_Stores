import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import { TabLinks } from '@/components/admin/kit/core'
import ProvidersCard from '@/components/admin/site-controls/ProvidersCard'
import ServerPricingClient from './ServerPricingClient'
import MessagingAddonPricingClient from './MessagingAddonPricingClient'

export const dynamic = 'force-dynamic'

const TABS = [
  { id: 'pricing', label: 'Server pricing', href: '/admin/ecom/configuration' },
  { id: 'providers', label: 'Providers', href: '/admin/ecom/configuration?tab=providers' },
  { id: 'messaging', label: 'SMS & WhatsApp add-on', href: '/admin/ecom/configuration?tab=messaging' },
] as const
type Tab = (typeof TABS)[number]['id']

export default async function ConfigurationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const h = await headers()
  if (h.get('x-tenant-id')) notFound()
  if (!isPlatformAdmin(h.get('x-user-role') || '')) redirect('/admin')
  const { tab: raw } = await searchParams
  const tab: Tab = raw === 'providers' || raw === 'messaging' ? raw : 'pricing'
  return (
    <PageBody>
      <PageHeader
        title="Configuration"
        description="Server pricing and margins, the SMS & WhatsApp add-on fee, and which providers send messages and serve AI for every store."
      />
      <TabLinks tabs={TABS} value={tab} replace />
      {tab === 'pricing' ? <ServerPricingClient /> : tab === 'messaging' ? <MessagingAddonPricingClient /> : <ProvidersCard />}
    </PageBody>
  )
}

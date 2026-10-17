import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import AiPricingClient from './AiPricingClient'

export const dynamic = 'force-dynamic'

export default async function AiPricingPage() {
  const h = await headers()
  // Control-plane page: a tenant host 404s it, as it did under /ecom.
  if (h.get('x-tenant-id')) notFound()
  if (!isPlatformAdmin(h.get('x-user-role') || '')) redirect('/admin')
  return (
    <PageBody>
      <PageHeader
        title="AI Pricing"
        description="Per-unit cost and the price stores are charged to their wallet. The flagship is never charged. Changes apply within 5 minutes."
      />
      <AiPricingClient />
    </PageBody>
  )
}

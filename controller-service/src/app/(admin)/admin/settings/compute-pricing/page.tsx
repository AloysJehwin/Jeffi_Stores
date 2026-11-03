import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import ComputePricingClient from './ComputePricingClient'

export const dynamic = 'force-dynamic'

export default async function ComputePricingPage() {
  const h = await headers()
  if (h.get('x-tenant-id')) notFound()
  if (!isPlatformAdmin(h.get('x-user-role') || '')) redirect('/admin')
  return (
    <PageBody>
      <PageHeader
        title="Server Pricing"
        description="AWS list prices (USD) and the rate, margin and sharing the store size calculator prices with. Stores pay these from their wallet by the hour."
      />
      <ComputePricingClient />
    </PageBody>
  )
}

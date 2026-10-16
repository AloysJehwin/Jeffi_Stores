import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import AiPricingClient from './AiPricingClient'

export const dynamic = 'force-dynamic'

export default async function AiPricingPage() {
  const h = await headers()
  // Control-plane page: a tenant host 404s it, as it did under /ecom.
  if (h.get('x-tenant-id')) notFound()
  if (!isPlatformAdmin(h.get('x-user-role') || '')) redirect('/admin')
  return (
    <div className="p-6 w-full">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">AI Pricing</h1>
        <p className="text-sm text-foreground-muted mt-1">
          Per-unit cost and the price stores are charged to their wallet. The flagship is never charged. Changes apply
          within 5 minutes.
        </p>
      </div>
      <AiPricingClient />
    </div>
  )
}

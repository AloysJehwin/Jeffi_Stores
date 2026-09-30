import { headers } from 'next/headers'
import { hasScope } from '@/lib/auth/scopes'
import OffersTabs from './OffersTabs'

export const dynamic = 'force-dynamic'

export default async function OffersPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'coupons:write')

  return (
    <div className="p-6 w-full max-w-full min-w-0">
      <h1 className="text-2xl font-bold text-foreground">Offers</h1>
      <p className="text-sm text-foreground-muted mt-1 mb-6">
        Razorpay bank offers shown on product pages, and your own product offers with their titles, dates, images, and
        assigned products.
      </p>
      <OffersTabs canWrite={canWrite} />
    </div>
  )
}

import { headers } from 'next/headers'
import { hasScope } from '@/lib/auth/scopes'
import OffersTabs from './OffersTabs'
import { PageBody, PageHeader } from '@/components/admin/kit'
import PageDrafts from '@/components/admin/drafts/PageDrafts'

export const dynamic = 'force-dynamic'

export default async function OffersPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'coupons:write')

  return (
    <PageBody>
      <PageHeader
        title="Offers"
        description="Razorpay bank offers shown on product pages, and your own product offers with their titles, dates, images, and assigned products."
      />
      <PageDrafts type="offer" />
      <OffersTabs canWrite={canWrite} />
    </PageBody>
  )
}

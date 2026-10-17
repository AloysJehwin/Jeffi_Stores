import { queryMany } from '@/lib/shared/db'
import { FormPage, PageHeader } from '@/components/admin/kit'
import ReviewFormForm from '../ReviewFormForm'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import MobileEditBlock from '@/components/admin/MobileEditBlock'

export const dynamic = 'force-dynamic'

interface Coupon {
  id: string
  code: string
  description: string | null
}

export default async function AddReviewFormPage() {
  const host = await getHost()
  const coupons = await queryMany<Coupon>(
    'SELECT id, code, description FROM coupons WHERE is_active = true ORDER BY code'
  )

  return (
    <MobileEditBlock>
      <FormPage header={<PageHeader back={{ href: ap('/admin/review-forms', host), label: 'Review Forms' }} title="Create Review Form" description="Build a shareable form to collect Google reviews" />}>
        <ReviewFormForm submitLabel="Save as Draft" coupons={coupons} />
      </FormPage>
    </MobileEditBlock>
  )
}

import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { FormPage, PageHeader } from '@/components/admin/kit'
import CouponForm from '../CouponForm'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { createCoupon } from './actions'

export const dynamic = 'force-dynamic'

export default async function AddCouponPage() {
  const host = await getHost()
  return (
    <MobileEditBlock>
      <FormPage header={<PageHeader back={{ href: ap('/admin/coupons', host), label: 'Coupons' }} title="Add Coupon" description="Create a new discount coupon" />}>
        <CouponForm action={createCoupon} submitLabel="Save as Draft" showUserSelector />
      </FormPage>
    </MobileEditBlock>
  )
}

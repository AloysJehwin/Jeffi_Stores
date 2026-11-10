import { BillingDetailLoading, TenantDetailLoading } from '../../../_components/detail-skeletons'

export default function Loading() {
  return (
    <TenantDetailLoading back="Billing" section="billing">
      <BillingDetailLoading />
    </TenantDetailLoading>
  )
}

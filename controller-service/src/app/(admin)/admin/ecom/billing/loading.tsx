import { BillingOverviewLoading, EcomListLoading } from '../_components/skeletons'

export default function Loading() {
  return (
    <EcomListLoading title="Billing" description="Tenant transactions, splits & settlement. Click a store for detail." listLabel="All stores">
      <BillingOverviewLoading />
    </EcomListLoading>
  )
}

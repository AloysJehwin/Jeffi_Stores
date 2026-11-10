import { EcomListLoading, StoreStatusOverviewLoading } from '../_components/skeletons'

export default function Loading() {
  return (
    <EcomListLoading title="Store Status" description="Live status of each tenant store" listLabel="All stores">
      <StoreStatusOverviewLoading />
    </EcomListLoading>
  )
}

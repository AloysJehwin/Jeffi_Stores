import { CustomersOverviewLoading, EcomListLoading } from '../_components/skeletons'

export default function Loading() {
  return (
    <EcomListLoading title="Customers" description="Stores and API (Messaging / Documents) workspaces" listLabel="All customers">
      <CustomersOverviewLoading />
    </EcomListLoading>
  )
}

import { InfrastructureLoading, TenantDetailLoading } from '../../../_components/detail-skeletons'

export default function Loading() {
  return (
    <TenantDetailLoading back="Instances" section="instance">
      <InfrastructureLoading />
    </TenantDetailLoading>
  )
}

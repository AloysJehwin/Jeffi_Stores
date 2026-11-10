import { EcomListLoading, InstancesOverviewLoading } from '../_components/skeletons'

export default function Loading() {
  return (
    <EcomListLoading title="Instances" description="What each store runs and what it costs" listLabel="All instances">
      <InstancesOverviewLoading />
    </EcomListLoading>
  )
}

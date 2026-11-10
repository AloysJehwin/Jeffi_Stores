import { PipelineLoading, PipelineToolbarLoading } from '@controller/components/admin/ecom/pipeline/PipelineLoading'
import { HealthLoading, RunningNowLoading, SurfacesLoading, TenantDetailLoading } from '../../../_components/detail-skeletons'

export default function Loading() {
  return (
    <TenantDetailLoading back="Store Status" section="status">
      <HealthLoading />
      <RunningNowLoading />
      <SurfacesLoading />
      <section className="space-y-3 min-w-0">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Provisioning timeline</h2>
        <div className="space-y-5 min-w-0">
          <PipelineToolbarLoading />
          <PipelineLoading />
        </div>
      </section>
    </TenantDetailLoading>
  )
}

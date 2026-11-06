'use client'

import { PipelineView } from './pipeline/PipelineView'

/** The tenant's provisioning run (pipeline/PipelineView). */
export default function ProvisioningLogsClient({ tenantId }: { tenantId: string }) {
  return <PipelineView tenantId={tenantId} />
}

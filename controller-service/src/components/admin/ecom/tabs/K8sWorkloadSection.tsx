import type { TenantDetailData, InfraDetail } from '@controller/lib/ecom/detail'
import { Field, FieldGrid, Section, Mono } from '../EcomUI'
import { tenantNamespace } from '@/lib/provisioning/tiers'
import { legacySpecFor } from '@/lib/compute/legacy'
import { POD_RESOURCES } from '@/lib/compute/presets'
import { FLEET_UNKNOWN } from '../cells'
import { Deployments } from '../detail/RunningNow'
import { PodsTable } from '../detail/FleetTables'
import ComputeRetryButton from './ComputeRetryButton'

const CONSOLE = 'https://k8s.jeffistores.in'

const stepOf = (p: Record<string, any> | null) =>
  p?.move ? `moving database: ${p.move.step}` : p?.gen != null ? 'new servers' : p?.dbClass ? 'database size' : p?.dbOnline ? 'database storage' : null

// What the store runs on k3s: its namespace, the compute change in flight, each Deployment and the pods
// (read straight from the API server, so it reflects the cluster even when the job JSON is stale).
export default function K8sWorkloadSection({ d, infra, pendingPlan, planError }: { d: TenantDetailData; infra: InfraDetail; pendingPlan?: string | null; planError?: string | null }) {
  const { t } = d
  const { compute: row, workload: status } = infra
  const spec = infra.spec ?? legacySpecFor(t.plan)
  const ctrl = POD_RESOURCES.storefront[spec.services.storefront.size]
  const ns = tenantNamespace(t.slug)
  const links = (
    <div className="flex gap-3 text-xs">
      <a className="underline" href={`${CONSOLE}/headlamp/c/main/namespaces/${ns}`} target="_blank" rel="noreferrer">
        Headlamp
      </a>
      <a className="underline" href={`${CONSOLE}/`} target="_blank" rel="noreferrer">
        Coroot
      </a>
    </div>
  )

  return (
    <Section title="Workloads" action={links}>
      <FieldGrid>
        <Field label="Namespace" value={<Mono>{ns}</Mono>} />
        <Field
          label="Placement"
          value={spec.node.placement === 'dedicated' ? `Own ${spec.node.count > 1 ? `${spec.node.count}× ` : ''}${spec.node.type}` : 'Shared basic pool'}
        />
        <Field label="Pod size" value={`${ctrl.requests.cpu} / ${ctrl.limits.memory}`} />
        <Field
          label="Replicas"
          value={status ? `${status.ready}/${status.desired} ready` : status === null ? 'Not deployed' : 'Cluster unreachable'}
        />
        <Field
          wide
          label="Compute"
          value={
            !row ? (
              'No compute row yet'
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span className={row.status === 'failed' ? 'text-red-600 dark:text-red-400 break-words' : 'break-words'}>
                  <span className="capitalize">{row.status}</span>
                  {stepOf(row.progress) ? ` (${stepOf(row.progress)})` : ''}
                  {row.last_error ? `: ${row.last_error}` : ''}
                </span>
                {row.status === 'failed' && <ComputeRetryButton tenantId={t.id} />}
              </span>
            )
          }
        />
        <Field wide label="Image" value={status?.image ? <Mono>{status.image.split('/').pop()}</Mono> : '—'} />
        {(pendingPlan || planError) && (
          <Field
            wide
            label="Plan change"
            value={
              <span className={planError ? 'text-red-600 dark:text-red-400' : undefined}>
                {planError ? `Not applied${pendingPlan ? ' (retrying)' : ''}: ${planError}` : `Applying "${pendingPlan}"…`}
              </span>
            }
          />
        )}
      </FieldGrid>

      <div className="mt-4 space-y-4 min-w-0">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">Deployments</h3>
          {d.fleetKnown ? <Deployments d={d} /> : <p className="text-sm text-foreground-muted">{FLEET_UNKNOWN}</p>}
        </div>
        {status && status.pods.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">Pods</h3>
            <PodsTable pods={status.pods} />
          </div>
        )}
      </div>
    </Section>
  )
}

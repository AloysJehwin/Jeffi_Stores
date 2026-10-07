import { Field, FieldGrid, Section, Mono } from '../EcomUI'
import { computeTierFor, tenantNamespace } from '@/lib/provisioning/tiers'

const CONSOLE = 'https://k8s.jeffistores.in'

// Live pods for a tenant running on k3s. Read straight from the API server, so it reflects the
// cluster even when the provisioning job JSON is stale.
export default async function K8sWorkloadSection({ slug, plan }: { slug: string; plan: string | null }) {
  const tier = computeTierFor(plan)
  const { getTenantWorkloadStatus } = await import('@/lib/k8s/tenant-compute')
  const status = await getTenantWorkloadStatus(slug).catch(() => undefined)
  const ns = tenantNamespace(slug)
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
    <Section title="Kubernetes" action={links}>
      <FieldGrid>
        <Field label="Namespace" value={<Mono>{ns}</Mono>} />
        <Field
          label="Placement"
          value={tier.placement === 'dedicated' ? `Dedicated ${tier.nodeType}` : 'Shared basic pool'}
        />
        <Field label="Pod size" value={`${tier.requests.cpu} / ${tier.limits.memory}`} />
        <Field
          label="Replicas"
          value={
            status
              ? `${status.ready}/${status.desired} ready`
              : status === null
                ? 'Not deployed'
                : 'Cluster unreachable'
          }
        />
        <Field wide label="Image" value={status?.image ? <Mono>{status.image.split('/').pop()}</Mono> : '—'} />
      </FieldGrid>
      {status && status.pods.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-foreground-muted">
              <tr>
                <th className="py-1 pr-4 font-medium">Pod</th>
                <th className="py-1 pr-4 font-medium">Status</th>
                <th className="py-1 pr-4 font-medium">Restarts</th>
                <th className="py-1 pr-4 font-medium">Node</th>
                <th className="py-1 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {status.pods.map(p => (
                <tr key={p.name} className="border-t border-border">
                  <td className="py-1.5 pr-4">
                    <Mono>{p.name}</Mono>
                  </td>
                  <td className="py-1.5 pr-4">{p.ready ? 'Ready' : p.phase}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{p.restarts}</td>
                  <td className="py-1.5 pr-4">{p.node ?? '—'}</td>
                  <td className="py-1.5">{p.startedAt ? new Date(p.startedAt).toLocaleString('en-IN') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

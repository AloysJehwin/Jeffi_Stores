import type { TenantDetailData, InfraDetail } from '@controller/lib/ecom/detail'
import type { ComputeSpec } from '@/lib/compute/spec'
import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import { Field, FieldGrid, Section, Mono, StatusPill, NOT_PROVISIONED } from '../EcomUI'
import { FLEET_UNKNOWN, bytes, dateIN, dateTimeIN } from '../cells'
import { ServersTable } from '../detail/FleetTables'
import CostBreakdown from '../detail/CostBreakdown'
import Copyable from '../detail/Copyable'
import DnsResyncButton from '../detail/DnsResyncButton'
import K8sWorkloadSection from './K8sWorkloadSection'

const SCHEMA: StatusMap = { behind: { label: 'Behind', tone: 'amber' }, current: { label: 'Current', tone: 'green' } }

const DB_MODE: Record<ComputeSpec['db']['mode'], string> = {
  node: 'Postgres on its own server',
  shared: 'Shared RDS (with other stores)',
  dedicated: 'Its own RDS instance',
}

/**
 * The store's infrastructure: servers, workloads, database, storage, what it costs, DNS, schema and domains.
 * Body of the Instance page and of the Store page's Infrastructure tab.
 */
export default function InfrastructureTab({ d, infra }: { d: TenantDetailData; infra: InfraDetail }) {
  const { t, job, fleet, fleetKnown, row } = d
  const { domains, migrations, currentSha, spec } = infra
  const latest = migrations[0] ?? null
  const behind = !!(currentSha && latest && latest.git_sha !== currentSha)
  const res = (job?.created_resources as Record<string, unknown>) || {}
  const hosts: string[] = Array.isArray(res.dnsHosts) ? (res.dnsHosts as string[]) : []
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const servers = fleet?.servers ?? []

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <Section title="Servers">
        {!fleetKnown ? (
          <p className="text-sm text-foreground-muted">{FLEET_UNKNOWN}</p>
        ) : fleet?.placement === 'pool' && servers.length === 0 ? (
          <p className="text-sm text-foreground-muted">Runs on the shared basic pool: no servers of its own.</p>
        ) : (
          <ServersTable servers={servers} />
        )}
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={res.computeMode === 'k8s' ? 'Ingress IP' : 'EC2 target'} value={t.ec2_target ? <Copyable value={t.ec2_target} /> : 'shared pool'} />
          <Field label="Instance id (infra)" value={t.ec2_instance_id ? <Copyable value={t.ec2_instance_id} /> : '—'} />
          <Field label="Instance state" value={<span className="capitalize">{t.instance_state}</span>} />
        </dl>
      </Section>

      <K8sWorkloadSection d={d} infra={infra} pendingPlan={str(res.k8sPendingPlan)} planError={str(res.k8sPlanError)} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <Section title="Database">
          <FieldGrid>
            <Field label="Mode" value={spec ? DB_MODE[spec.db.mode] : '—'} />
            <Field
              label="Size"
              value={spec ? [spec.db.class, spec.db.multiAz ? 'Multi-AZ' : null, `${spec.db.storageGb} GB`].filter(Boolean).join(' · ') : '—'}
            />
            <Field label="Backups" value={!spec ? '—' : spec.db.mode === 'node' ? `Disk snapshots (${spec.db.storageGb} GB)` : 'RDS automated backups'} />
            {fleet?.postgresReady != null && <Field label="Postgres pod" value={fleet.postgresReady ? 'Ready' : <span className="text-red-600 dark:text-red-400">Not ready</span>} />}
            <Field wide label="Endpoint" value={t.rds_endpoint ? <Copyable value={t.rds_endpoint} /> : t.shared_db_host ? <Copyable value={t.shared_db_host} /> : NOT_PROVISIONED} />
            <Field label="Database" value={t.rds_db} />
            <Field label="Port" value={t.rds_port} />
            <Field label="Auth" value={t.iam_auth ? 'IAM (app_user)' : 'Password'} />
            <Field label="User" value={t.rds_user ? <Mono>{t.rds_user}</Mono> : '—'} />
            <Field label="Instance id" value={str(res.dbInstanceId) ? <Copyable value={str(res.dbInstanceId)} /> : '—'} />
            <Field label="Param group" value={str(res.paramGroup) ? <Mono>{str(res.paramGroup)}</Mono> : '—'} />
            <Field label="Region" value={t.region} />
          </FieldGrid>
        </Section>

        <Section title="Storage">
          <FieldGrid>
            <Field wide label="S3 bucket" value={t.s3_bucket ? <Copyable value={t.s3_bucket} /> : NOT_PROVISIONED} />
            <Field label="Used" value={<span className="tabular-nums">{bytes(row?.s3_usage_bytes)}</span>} />
            <Field label="Allowance" value={spec?.storage?.s3Gb ? `${spec.storage.s3Gb} GB` : '—'} />
            <Field wide label="CloudFront" value={t.cloudfront_id ? <Copyable value={t.cloudfront_id} /> : '—'} />
            <Field label="Plan" value={<span className="capitalize">{t.plan || '—'}</span>} />
            <Field label="Created" value={dateIN(t.created_at)} />
          </FieldGrid>
        </Section>
      </div>

      <CostBreakdown infra={infra} />

      <Section title="DNS" action={<DnsResyncButton tenantId={t.id} disabled={t.status !== 'active'} />}>
        <p className="text-xs text-foreground-muted mb-3">Re-sync adds any host the current plan includes (e.g. forms-) and removes hosts it no longer does. Active stores only.</p>
        {hosts.length === 0 ? (
          <p className="text-sm text-foreground-muted">No DNS records recorded for this tenant yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {hosts.map(host => (
              <li key={host} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm min-w-0">
                <span className="min-w-0 font-mono text-xs text-foreground break-all">{host}</span>
                <span className="min-w-0 text-xs text-foreground-muted break-all">→ {t.ec2_target || 'pool'}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Schema version"
        action={latest && <StatusBadge status={behind ? 'behind' : 'current'} map={SCHEMA} />}
      >
        {migrations.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            No migration has run against this store&apos;s database. Its schema is whatever provisioning created; it has not received any later change.
          </p>
        ) : (
          <>
            <FieldGrid>
              <Field label="Store is on" value={<Mono>{latest!.git_sha.slice(0, 10)}</Mono>} />
              <Field label="Platform is on" value={currentSha ? <Mono>{currentSha.slice(0, 10)}</Mono> : '—'} />
              <Field label="Last run" value={dateTimeIN(latest!.ran_at)} />
              <Field
                label="Result"
                value={latest!.status === 'success' ? <span className="text-green-600 dark:text-green-400">success</span> : <span className="text-red-600 dark:text-red-400">{latest!.status}</span>}
              />
            </FieldGrid>
            {latest!.error && <p className="mt-3 text-xs text-red-600 dark:text-red-400 break-words">{latest!.error}</p>}
            {migrations.length > 1 && (
              <ul className="mt-4 pt-4 border-t border-border-default space-y-1.5">
                {migrations.slice(1).map(m => (
                  <li key={`${m.git_sha}-${m.ran_at}`} className="flex items-center justify-between gap-3 text-xs min-w-0">
                    <Mono>{m.git_sha.slice(0, 10)}</Mono>
                    <span className={`shrink-0 ${m.status === 'success' ? 'text-foreground-muted' : 'text-red-600 dark:text-red-400'}`}>
                      {m.status} · {dateIN(m.ran_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="Custom domains">
        {domains.length === 0 ? (
          <p className="text-sm text-foreground-muted">No custom domain. The store is reachable on its jeffistores.in subdomains only.</p>
        ) : (
          <ul className="space-y-3">
            {domains.map(dm => (
              <li key={dm.id} className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="text-sm text-foreground break-all">{dm.domain}</div>
                  {dm.status !== 'verified' && dm.verification_token && (
                    <div className="text-xs text-foreground-muted break-all mt-0.5">
                      token <span className="font-mono">{dm.verification_token}</span>
                    </div>
                  )}
                  {dm.cert_arn && <div className="text-xs text-foreground-muted break-all mt-0.5">cert {dm.cert_arn.split('/').pop()}</div>}
                </div>
                <div className="text-right shrink-0">
                  <StatusPill status={dm.status} />
                  {dm.verified_at && <div className="text-xs text-foreground-muted mt-1">{dateIN(dm.verified_at)}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

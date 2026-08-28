import type { TenantDetail, ProvisioningJob, CustomDomain } from '@/lib/tenant-registry'
import type { TenantMigrationRun } from '@/lib/tenant-migrations'
import { Field, FieldGrid, Section, Mono, StatusPill, NOT_PROVISIONED } from '../EcomUI'

export default function InfrastructureTab({
  tenant: t, job, domains, migrations, currentSha,
}: {
  tenant: TenantDetail
  job: ProvisioningJob | null
  domains: CustomDomain[]
  migrations: TenantMigrationRun[]
  currentSha: string | null
}) {
  const latest = migrations[0] ?? null
  const behind = !!(currentSha && latest && latest.git_sha !== currentSha)
  const res = (job?.created_resources as Record<string, unknown>) || {}
  const hosts: string[] = Array.isArray(res.dnsHosts) ? (res.dnsHosts as string[]) : []
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

  return (
    <div className="space-y-6 min-w-0">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Database">
          <FieldGrid>
            <Field wide label="RDS endpoint" value={t.rds_endpoint ? <Mono>{t.rds_endpoint}</Mono> : NOT_PROVISIONED} />
            <Field label="Database" value={t.rds_db} />
            <Field label="Port" value={t.rds_port} />
            <Field label="Auth" value={t.iam_auth ? 'IAM (app_user)' : 'Password'} />
            <Field label="Instance id" value={str(res.dbInstanceId) ? <Mono>{str(res.dbInstanceId)}</Mono> : '—'} />
            <Field label="Param group" value={str(res.paramGroup) ? <Mono>{str(res.paramGroup)}</Mono> : '—'} />
            <Field label="Region" value={t.region} />
          </FieldGrid>
        </Section>

        <Section title="Compute & storage">
          <FieldGrid>
            <Field label="EC2 target" value={t.ec2_target || 'shared pool'} />
            <Field label="Instance state" value={<span className="capitalize">{t.instance_state}</span>} />
            <Field label="S3 bucket" value={t.s3_bucket ? <Mono>{t.s3_bucket}</Mono> : NOT_PROVISIONED} />
            <Field label="CloudFront" value={t.cloudfront_id ? <Mono>{t.cloudfront_id}</Mono> : '—'} />
            <Field label="Plan" value={<span className="capitalize">{t.plan || '—'}</span>} />
            <Field label="Created" value={new Date(t.created_at).toLocaleDateString('en-IN')} />
          </FieldGrid>
        </Section>
      </div>

      <Section
        title="Schema version"
        action={latest && (
          behind
            ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">behind</span>
            : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">current</span>
        )}
      >
        {migrations.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            No migration has run against this store&apos;s database. Its schema is whatever
            provisioning created — it has not received any later change.
          </p>
        ) : (
          <>
            <FieldGrid>
              <Field label="Store is on" value={<Mono>{latest!.git_sha.slice(0, 10)}</Mono>} />
              <Field label="Platform is on" value={currentSha ? <Mono>{currentSha.slice(0, 10)}</Mono> : '—'} />
              <Field label="Last run" value={new Date(latest!.ran_at).toLocaleString('en-IN')} />
              <Field label="Result" value={
                latest!.status === 'success'
                  ? <span className="text-green-600 dark:text-green-400">success</span>
                  : <span className="text-red-600 dark:text-red-400">{latest!.status}</span>
              } />
            </FieldGrid>
            {latest!.error && (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400 break-words">{latest!.error}</p>
            )}
            {migrations.length > 1 && (
              <ul className="mt-4 pt-4 border-t border-border-default space-y-1.5">
                {migrations.slice(1).map((m) => (
                  <li key={`${m.git_sha}-${m.ran_at}`} className="flex items-center justify-between gap-3 text-xs min-w-0">
                    <Mono>{m.git_sha.slice(0, 10)}</Mono>
                    <span className={m.status === 'success' ? 'text-foreground-muted' : 'text-red-600 dark:text-red-400'}>
                      {m.status} · {new Date(m.ran_at).toLocaleDateString('en-IN')}
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
          <p className="text-sm text-foreground-muted">
            No custom domain. The store is reachable on its jeffistores.in subdomains only.
          </p>
        ) : (
          <ul className="space-y-3">
            {domains.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="text-sm text-foreground break-all">{d.domain}</div>
                  {d.status !== 'verified' && d.verification_token && (
                    <div className="text-xs text-foreground-muted break-all mt-0.5">
                      token <span className="font-mono">{d.verification_token}</span>
                    </div>
                  )}
                  {d.cert_arn && <div className="text-xs text-foreground-muted break-all mt-0.5">cert {d.cert_arn.split('/').pop()}</div>}
                </div>
                <div className="text-right shrink-0">
                  <StatusPill status={d.status} />
                  {d.verified_at && (
                    <div className="text-xs text-foreground-muted mt-1">
                      {new Date(d.verified_at).toLocaleDateString('en-IN')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="DNS">
        {hosts.length === 0 ? (
          <p className="text-sm text-foreground-muted">No DNS records recorded for this tenant yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {hosts.map((host) => (
              <li key={host} className="flex items-center justify-between gap-3 text-sm min-w-0">
                <span className="font-mono text-xs text-foreground break-all">{host}</span>
                <span className="text-xs text-foreground-muted shrink-0">→ {t.ec2_target || 'pool'}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

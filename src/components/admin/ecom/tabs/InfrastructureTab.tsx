import type { TenantDetail, ProvisioningJob } from '@/lib/tenant-registry'
import { Field, FieldGrid, Section, Mono, NOT_PROVISIONED } from '../EcomUI'

export default function InfrastructureTab({
  tenant: t, job,
}: {
  tenant: TenantDetail
  job: ProvisioningJob | null
}) {
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

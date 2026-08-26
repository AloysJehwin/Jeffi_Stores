import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import { getTenant, getProvisioningJob } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import TenantActions from '@/components/admin/ecom/TenantActions'

export const dynamic = 'force-dynamic'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-foreground-muted">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5 break-all">{value ?? '—'}</dd>
    </div>
  )
}

const NOT_PROVISIONED = <span className="text-amber-500">not provisioned</span>

export default async function InstanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const { id } = await params
  const [t, job] = await Promise.all([getTenant(id), getProvisioningJob(id).catch(() => null)])
  if (!t) notFound()

  const res = (job?.created_resources as Record<string, any>) || {}
  const hosts: string[] = Array.isArray(res.dnsHosts) ? res.dnsHosts : []

  return (
    <div className="p-6 w-full">
      <Link href="/admin/ecom/instances" className="text-sm text-accent-600 dark:text-accent-400 hover:underline">← Instances</Link>
      <div className="flex items-center gap-3 mt-2 mb-1 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">{t.display_name}</h1>
        <StatusPill status={t.status} />
        {!t.rds_endpoint && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            No infrastructure
          </span>
        )}
      </div>
      <p className="text-sm text-foreground-muted mb-6">
        {t.slug}.jeffistores.in ·{' '}
        <Link href={`/admin/ecom/customers/${t.id}`} className="text-accent-600 dark:text-accent-400 hover:underline">Customer</Link>
        {' · '}
        <Link href={`/admin/ecom/provisioning/${t.id}`} className="text-accent-600 dark:text-accent-400 hover:underline">Provisioning logs</Link>
      </p>

      <div className="mb-6">
        <TenantActions tenantId={t.id} slug={t.slug} status={t.status} instanceState={t.instance_state} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-border-default p-5 bg-surface-elevated">
          <h2 className="font-semibold text-foreground mb-4">Database</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-foreground-muted">RDS endpoint</dt>
              <dd className="text-sm text-foreground mt-0.5 font-mono text-xs break-all">{t.rds_endpoint || NOT_PROVISIONED}</dd>
            </div>
            <Field label="Database" value={t.rds_db} />
            <Field label="Port" value={t.rds_port} />
            <Field label="Auth" value={t.iam_auth ? 'IAM (app_user)' : 'Password'} />
            <Field label="Instance id" value={<span className="font-mono text-xs">{res.dbInstanceId || '—'}</span>} />
            <Field label="Param group" value={<span className="font-mono text-xs">{res.paramGroup || '—'}</span>} />
            <Field label="Region" value={t.region} />
          </dl>
        </section>

        <section className="rounded-xl border border-border-default p-5 bg-surface-elevated">
          <h2 className="font-semibold text-foreground mb-4">Compute &amp; storage</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="EC2 target" value={t.ec2_target || 'shared pool'} />
            <Field label="Instance state" value={<span className="capitalize">{t.instance_state}</span>} />
            <Field label="S3 bucket" value={<span className="font-mono text-xs">{t.s3_bucket}</span>} />
            <Field label="CloudFront" value={t.cloudfront_id} />
            <Field label="Plan" value={<span className="capitalize">{t.plan || '—'}</span>} />
            <Field label="Created" value={new Date(t.created_at).toLocaleDateString('en-IN')} />
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-border-default p-5 bg-surface-elevated mt-6">
        <h2 className="font-semibold text-foreground mb-4">DNS</h2>
        {hosts.length === 0 ? (
          <p className="text-sm text-foreground-muted">No DNS records recorded for this tenant yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {hosts.map((host) => (
              <li key={host} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-foreground">{host}</span>
                <span className="text-xs text-foreground-muted">→ {t.ec2_target || 'pool'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

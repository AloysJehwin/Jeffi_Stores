import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import { getTenant, getProvisioningJob } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import TenantActions from '@/components/admin/ecom/TenantActions'

export const dynamic = 'force-dynamic'

const DOT: Record<string, string> = {
  active: 'bg-green-500', provisioning: 'bg-amber-500', suspended: 'bg-red-500', terminated: 'bg-foreground-muted',
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-foreground-muted">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5">{value ?? '—'}</dd>
    </div>
  )
}

function surfaces(slug: string, plan: string | null): string[] {
  const hosts = [`${slug}.jeffistores.in`, `admin-${slug}.jeffistores.in`, `invoice-${slug}.jeffistores.in`]
  if (plan && ['growth', 'pro', 'enterprise'].includes(plan)) {
    hosts.push(`quotation-${slug}.jeffistores.in`, `purchaseorder-${slug}.jeffistores.in`)
  }
  if (plan && ['pro', 'enterprise'].includes(plan)) {
    hosts.push(`forms-${slug}.jeffistores.in`, `${slug}.business.jeffistores.in`)
  }
  return hosts
}

export default async function StoreStatusDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const { id } = await params
  const [t, job] = await Promise.all([getTenant(id), getProvisioningJob(id).catch(() => null)])
  if (!t) notFound()

  const serving = t.status === 'active' && !!t.rds_endpoint

  return (
    <div className="p-6 w-full">
      <Link href="/admin/ecom/store-status" className="text-sm text-accent-600 dark:text-accent-400 hover:underline">← Store Status</Link>
      <div className="flex items-center gap-3 mt-2 mb-1 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">{t.display_name}</h1>
        <StatusPill status={t.status} />
      </div>
      <p className="text-sm text-foreground-muted mb-6">
        <Link href={`/admin/ecom/customers/${t.id}`} className="text-accent-600 dark:text-accent-400 hover:underline">Customer</Link>
        {' · '}
        <Link href={`/admin/ecom/instances/${t.id}`} className="text-accent-600 dark:text-accent-400 hover:underline">Instance</Link>
        {' · '}
        <Link href={`/admin/ecom/provisioning/${t.id}`} className="text-accent-600 dark:text-accent-400 hover:underline">Provisioning logs</Link>
      </p>

      <div className="mb-6">
        <TenantActions tenantId={t.id} slug={t.slug} status={t.status} instanceState={t.instance_state} />
      </div>

      <div className={`rounded-xl border p-5 mb-6 ${serving ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20' : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'}`}>
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${DOT[t.status] || DOT.terminated}`} />
          <span className="font-semibold text-foreground capitalize">{t.status}</span>
          <span className="text-sm text-foreground-muted">
            {serving ? 'Store is live and backed by its own database.' : 'Store is not serving customer traffic.'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-border-default p-5 bg-surface-elevated">
          <h2 className="font-semibold text-foreground mb-4">Health</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Tenant status" value={<span className="capitalize">{t.status}</span>} />
            <Field label="Instance state" value={<span className="capitalize">{t.instance_state}</span>} />
            <Field label="Database" value={t.rds_endpoint ? 'Provisioned' : <span className="text-amber-500">Missing</span>} />
            <Field label="Subscription" value={<span className="capitalize">{t.subscription_status}</span>} />
            <Field label="Last job" value={job ? <span className="font-mono text-xs">{job.status} · {job.step}</span> : '—'} />
            <Field label="Last change" value={job ? new Date(job.updated_at).toLocaleString('en-IN') : '—'} />
          </dl>
        </section>

        <section className="rounded-xl border border-border-default p-5 bg-surface-elevated">
          <h2 className="font-semibold text-foreground mb-4">Plan</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Plan" value={<span className="capitalize">{t.plan || '—'}</span>} />
            <Field label="Monthly" value={t.monthly_price_inr ? `₹${Number(t.monthly_price_inr).toLocaleString('en-IN')}` : '—'} />
            <Field label="Billing" value={<span className="capitalize">{t.billing_interval}</span>} />
            <Field label="Payout" value={t.daily_payout ? 'Daily (+5%)' : 'Weekly'} />
            <Field label="Custom domain" value={t.custom_domain} />
            <Field label="Created" value={new Date(t.created_at).toLocaleDateString('en-IN')} />
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-border-default p-5 bg-surface-elevated mt-6">
        <h2 className="font-semibold text-foreground mb-4">Surfaces</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {surfaces(t.slug, t.plan).map((host) => (
            <li key={host} className="flex items-center gap-2 text-sm">
              <span className={`w-1.5 h-1.5 rounded-full ${serving ? 'bg-green-500' : 'bg-foreground-muted'}`} />
              {serving
                ? <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent-600 dark:text-accent-400 hover:underline">{host} ↗</a>
                : <span className="font-mono text-xs text-foreground-muted">{host}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

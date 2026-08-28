import type { TenantDetail, ProvisioningJob } from '@/lib/tenant-registry'
import { Field, FieldGrid, Section, Mono, NOT_PROVISIONED } from '../EcomUI'

const DOT: Record<string, string> = {
  active: 'bg-green-500',
  provisioning: 'bg-amber-500',
  suspended: 'bg-red-500',
  terminated: 'bg-neutral-400',
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

export default function OverviewTab({ tenant: t, job }: { tenant: TenantDetail; job: ProvisioningJob | null }) {
  const serving = t.status === 'active' && !!t.rds_endpoint

  return (
    <div className="space-y-6 min-w-0">
      <div className={`rounded-xl border p-5 ${serving
        ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
        : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'}`}>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`w-2.5 h-2.5 rounded-full ${DOT[t.status] || DOT.terminated}`} />
          <span className="font-semibold text-foreground capitalize">{t.status}</span>
          <span className="text-sm text-foreground-muted">
            {serving ? 'Store is live and backed by its own database.' : 'Store is not serving customer traffic.'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Store">
          <FieldGrid>
            <Field label="Subdomain" value={<Mono>{t.slug}.jeffistores.in</Mono>} />
            <Field label="Custom domain" value={t.custom_domain} />
            <Field label="Plan" value={<span className="capitalize">{t.plan || '—'}</span>} />
            <Field label="Monthly" value={t.monthly_price_inr ? `₹${Number(t.monthly_price_inr).toLocaleString('en-IN')}` : '—'} />
            <Field label="Billing" value={<span className="capitalize">{t.billing_interval}</span>} />
            <Field label="Payout" value={t.daily_payout ? 'Daily (+5%)' : 'Weekly'} />
            <Field label="Subscription" value={<span className="capitalize">{t.subscription_status}</span>} />
            <Field label="Created" value={new Date(t.created_at).toLocaleDateString('en-IN')} />
          </FieldGrid>
        </Section>

        <Section title="Health">
          <FieldGrid>
            <Field label="Tenant status" value={<span className="capitalize">{t.status}</span>} />
            <Field label="Instance state" value={<span className="capitalize">{t.instance_state}</span>} />
            <Field label="Database" value={t.rds_endpoint ? 'Provisioned' : NOT_PROVISIONED} />
            <Field label="EC2 target" value={t.ec2_target || 'shared pool'} />
            <Field label="Region" value={t.region} />
            <Field label="Last job" value={job ? <Mono>{job.status} · {job.step}</Mono> : '—'} />
            <Field label="Last change" value={job ? new Date(job.updated_at).toLocaleString('en-IN') : '—'} />
            <Field wide label="Notification email" value={<Mono>{t.noreply_email}</Mono>} />
          </FieldGrid>
        </Section>
      </div>

      <Section title="Surfaces">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {surfaces(t.slug, t.plan).map((host) => (
            <li key={host} className="flex items-center gap-2 text-sm min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${serving ? 'bg-green-500' : 'bg-foreground-muted'}`} />
              {serving
                ? <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent-600 dark:text-accent-400 hover:underline break-all">{host} ↗</a>
                : <span className="font-mono text-xs text-foreground-muted break-all">{host}</span>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

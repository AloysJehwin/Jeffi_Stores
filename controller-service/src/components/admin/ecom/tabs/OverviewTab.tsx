import type { TenantDetail, ProvisioningJob, TenantOwner, ServiceApproval } from '@/lib/tenant-registry'
import { hasService } from '@/lib/tenant-registry'
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

export default function OverviewTab({
  tenant: t,
  job,
  owners,
  approvals = [],
}: {
  tenant: TenantDetail
  job: ProvisioningJob | null
  owners: TenantOwner[]
  approvals?: ServiceApproval[]
}) {
  if (!hasService(t, 'store')) return <ApiOverview tenant={t} owners={owners} approvals={approvals} />
  const serving = t.status === 'active' && !!t.rds_endpoint

  return (
    <div className="space-y-6 min-w-0">
      <div
        className={`rounded-xl border p-5 ${
          serving
            ? 'border-green-500/40 bg-green-500/5'
            : 'border-amber-500/40 bg-amber-500/5'
        }`}
      >
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
            <Field
              label="Monthly"
              value={t.monthly_price_inr ? `₹${Number(t.monthly_price_inr).toLocaleString('en-IN')}` : '—'}
            />
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
            <Field
              label="Last job"
              value={
                job ? (
                  <Mono>
                    {job.status} · {job.step}
                  </Mono>
                ) : (
                  '—'
                )
              }
            />
            <Field label="Last change" value={job ? new Date(job.updated_at).toLocaleString('en-IN') : '—'} />
            <Field wide label="Notification email" value={<Mono>{t.noreply_email}</Mono>} />
          </FieldGrid>
        </Section>
      </div>

      <Owners owners={owners} />

      <Section title="Surfaces">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {surfaces(t.slug, t.plan).map(host => (
            <li key={host} className="flex items-center gap-2 text-sm min-w-0">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${serving ? 'bg-green-500' : 'bg-foreground-muted'}`}
              />
              {serving ? (
                <a
                  href={`https://${host}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-accent-600 hover:underline break-all"
                >
                  {host} ↗
                </a>
              ) : (
                <span className="font-mono text-xs text-foreground-muted break-all">{host}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function Owners({ owners }: { owners: TenantOwner[] }) {
  return (
    <Section title="Owners">
        {owners.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            No owner linked to this workspace. It cannot be signed into from ecom.jeffistores.in.
          </p>
        ) : (
          <ul className="space-y-3">
            {owners.map(o => (
              <li key={o.id} className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="text-sm text-foreground break-all">{o.name || o.email}</div>
                  {o.name && <div className="text-xs text-foreground-muted break-all">{o.email}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs capitalize text-foreground-secondary">{o.role}</div>
                  <div className="text-xs text-foreground-muted">
                    since {new Date(o.linked_at).toLocaleDateString('en-IN')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
  )
}

const API_TONE: Record<string, string> = { approved: 'bg-green-500', pending: 'bg-amber-500', rejected: 'bg-red-500' }

/** Messaging/Documents-only workspace: no store, database or instance — just its services. */
function ApiOverview({ tenant: t, owners, approvals }: { tenant: TenantDetail; owners: TenantOwner[]; approvals: ServiceApproval[] }) {
  const services = (t.service_types ?? []).filter(s => s !== 'store')
  const statusOf = (s: string) => approvals.find(a => a.service === s)?.status ?? 'approved'
  return (
    <div className="space-y-6 min-w-0">
      <div className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-5">
        <span className="font-semibold text-foreground">API workspace</span>
        <span className="ml-2 text-sm text-foreground-muted">Uses the Messaging / Documents APIs only — there is no store, database or instance to manage. It can add a store later from its console.</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Workspace">
          <FieldGrid>
            <Field label="Console slug" value={<Mono>{t.slug}</Mono>} />
            <Field label="Status" value={<span className="capitalize">{t.status}</span>} />
            <Field label="Created" value={new Date(t.created_at).toLocaleDateString('en-IN')} />
            <Field label="Notification email" value={<Mono>{t.noreply_email}</Mono>} />
          </FieldGrid>
        </Section>
        <Section title="Services">
          {services.length === 0 ? <p className="text-sm text-foreground-muted">No services enabled.</p> : (
            <ul className="space-y-2">
              {services.map(s => (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${API_TONE[statusOf(s)]}`} />
                  <span className="text-foreground">{s === 'messaging' ? 'Messaging API' : 'Documents API'}</span>
                  <span className="text-xs capitalize text-foreground-muted">{statusOf(s)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Owners owners={owners} />
    </div>
  )
}

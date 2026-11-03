import type { TenantDetail, TenantOwner, ServiceApproval } from '@/lib/tenant-registry'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import { StatusBadge } from '@/components/admin/kit/status'
import { Field, FieldGrid, Section, Mono, NOT_PROVISIONED } from '../EcomUI'
import { JOB_STATUS, TenantStatus, dateIN, dateTimeIN, inr } from '../cells'
import RunningNow from '../detail/RunningNow'
import CostSummary from '../detail/CostSummary'

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

export const isServing = (t: TenantDetail) => t.status === 'active' && !!t.rds_endpoint

/** One-line live / not-serving banner. */
export function ServingBanner({ t }: { t: TenantDetail }) {
  const serving = isServing(t)
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${serving ? 'border-green-500/40 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <div className="flex items-center gap-2.5 flex-wrap">
        <TenantStatus status={t.status} />
        <span className="text-sm text-foreground-muted">{serving ? 'Store is live and backed by its own database.' : 'Store is not serving customer traffic.'}</span>
      </div>
    </div>
  )
}

export default function OverviewTab({ d, owners }: { d: TenantDetailData; owners: TenantOwner[] }) {
  const { t, job } = d
  if (!d.isStore) return <ApiOverview tenant={t} owners={owners} approvals={d.approvals} />

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <ServingBanner t={t} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <RunningNow d={d} />
        <CostSummary d={d} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <Section title="Store">
          <FieldGrid>
            <Field label="Subdomain" value={<Mono>{t.slug}.jeffistores.in</Mono>} />
            <Field label="Custom domain" value={t.custom_domain ? <span className="break-all">{t.custom_domain}</span> : '—'} />
            <Field label="Plan" value={<span className="capitalize">{t.plan || '—'}</span>} />
            <Field label="Plan fee" value={t.monthly_price_inr ? `${inr(t.monthly_price_inr)}/mo` : '—'} />
            <Field label="Billing" value={<span className="capitalize">{t.billing_interval}</span>} />
            <Field label="Payout" value={t.daily_payout ? 'Daily (+5%)' : 'Weekly'} />
            <Field label="Subscription" value={<span className="capitalize">{t.subscription_status}</span>} />
            <Field label="Created" value={dateIN(t.created_at)} />
          </FieldGrid>
        </Section>

        <Section title="Health">
          <FieldGrid>
            <Field label="Instance state" value={<span className="capitalize">{t.instance_state}</span>} />
            <Field label="Database" value={t.rds_endpoint ? 'Provisioned' : NOT_PROVISIONED} />
            <Field label="EC2 target" value={t.ec2_target ? <Mono>{t.ec2_target}</Mono> : 'shared pool'} />
            <Field label="Region" value={t.region} />
            <Field label="Last job" value={job ? <span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={job.status} map={JOB_STATUS} /><Mono>{job.step}</Mono></span> : '—'} />
            <Field label="Last change" value={job ? dateTimeIN(job.updated_at) : '—'} />
            <Field wide label="Notification email" value={<Mono>{t.noreply_email}</Mono>} />
          </FieldGrid>
        </Section>
      </div>

      <Owners owners={owners} />
      <Surfaces t={t} />
    </div>
  )
}

/** The store's hosts, linked once it is serving. */
export function Surfaces({ t }: { t: TenantDetail }) {
  const serving = isServing(t)
  return (
    <Section title="Surfaces">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {surfaces(t.slug, t.plan).map(host => (
          <li key={host} className="flex items-center gap-2 text-sm min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${serving ? 'bg-green-500' : 'bg-foreground-muted'}`} />
            {serving ? (
              <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent-600 hover:underline break-all">
                {host} ↗
              </a>
            ) : (
              <span className="font-mono text-xs text-foreground-muted break-all">{host}</span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Owners({ owners }: { owners: TenantOwner[] }) {
  return (
    <Section title="Owners">
      {owners.length === 0 ? (
        <p className="text-sm text-foreground-muted">No owner linked to this workspace. It cannot be signed into from ecom.jeffistores.in.</p>
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
                <div className="text-xs text-foreground-muted">since {dateIN(o.linked_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

const API_TONE: Record<string, string> = { approved: 'bg-green-500', pending: 'bg-amber-500', rejected: 'bg-red-500' }

/** Messaging/Documents-only workspace: no store, database or instance, just its services. */
export function ApiOverview({ tenant: t, owners, approvals }: { tenant: TenantDetail; owners?: TenantOwner[]; approvals: ServiceApproval[] }) {
  const services = (t.service_types ?? []).filter(s => s !== 'store')
  const statusOf = (s: string) => approvals.find(a => a.service === s)?.status ?? 'approved'
  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <div className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-4 sm:p-5">
        <span className="font-semibold text-foreground">API workspace</span>
        <span className="ml-2 text-sm text-foreground-muted">
          Uses the Messaging / Documents APIs only. There is no store, database or instance to manage; it can add a store later from its console.
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <Section title="Workspace">
          <FieldGrid>
            <Field label="Console slug" value={<Mono>{t.slug}</Mono>} />
            <Field label="Status" value={<TenantStatus status={t.status} />} />
            <Field label="Created" value={dateIN(t.created_at)} />
            <Field label="Notification email" value={<Mono>{t.noreply_email}</Mono>} />
          </FieldGrid>
        </Section>
        <Section title="Services">
          {services.length === 0 ? (
            <p className="text-sm text-foreground-muted">No services enabled.</p>
          ) : (
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
      {owners && <Owners owners={owners} />}
    </div>
  )
}

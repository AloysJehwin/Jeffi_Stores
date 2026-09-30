import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { getOwnerTenants, getTenantBilling } from '@/lib/tenant-registry'
import { getSubscription } from '@/lib/payments/razorpay-subscriptions'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import SiteReachabilityBadge from './SiteReachabilityBadge'
import StoreDashboardTabs from './StoreDashboardTabs'
import SubdomainList from './SubdomainList'
import CustomDomains from './CustomDomains'
import DeliveryAccount from './DeliveryAccount'
import { hasOwnDelhiveryToken } from '@/lib/integrations/resolve'

export const dynamic = 'force-dynamic'

export default async function OwnerDashboard({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')

  const tenants = await getOwnerTenants(owner.id)
  if (tenants.length === 0) redirect('/onboard')

  // PRE-PAYMENT states belong in the onboard flow — the owner shouldn't reach the dashboard until
  // they've paid. /onboard shows the 'under review' → payment-link states for these.
  if (tenants.some(t => t.status === 'pending_approval' || t.status === 'awaiting_payment')) {
    redirect('/onboard')
  }

  const { tenant: wanted } = await searchParams
  const tenant =
    (wanted && tenants.find(t => t.slug === wanted)) || tenants.find(t => t.status === 'active') || tenants[0]

  const [billing, rzpSub] = await Promise.all([
    getTenantBilling(tenant.id),
    tenant.razorpay_subscription_id && tenant.subscription_status === 'active'
      ? getSubscription(tenant.razorpay_subscription_id).catch(() => null)
      : Promise.resolve(null),
  ])

  const renewalDate = rzpSub?.current_end
    ? new Date(rzpSub.current_end * 1000).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null

  const isLive = tenant.status === 'active'
  const ownDelhivery = tenant.own_delhivery === true
  const delhiveryTokenConnected = ownDelhivery ? await hasOwnDelhiveryToken(tenant.id) : false
  const storeUrl = `https://${tenant.slug}.jeffistores.in`
  const monthly = Number(tenant.monthly_price_inr ?? 0)
  const price = tenant.billing_interval === 'yearly' ? monthly * 12 : monthly

  const created = new Date(tenant.created_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const priceLabel =
    price > 0 ? `₹${price.toLocaleString('en-IN')}/${tenant.billing_interval === 'yearly' ? 'yr' : 'mo'}` : '—'

  return (
    <div className="w-full min-h-screen bg-surface-secondary">
      {/* Top bar */}
      <div className="border-b border-border-default bg-surface-elevated px-6 lg:px-10 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-xl font-bold text-foreground truncate">{tenant.display_name}</h1>
            <StatusPill status={tenant.status} />
            {isLive && <SiteReachabilityBadge url={storeUrl} />}
          </div>
          <div className="flex gap-2">
            <Link
              href={`/dashboard/billing?tenant=${tenant.slug}`}
              className="px-4 py-2 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
            >
              Billing
            </Link>
            {isLive && (
              <a
                href={storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors"
              >
                Open store →
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 lg:px-10 py-8 space-y-6">
        {/* ── Store overview: identity + subscription + infra ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <InfoCard title="Store identity">
            <Row label="Name" value={tenant.display_name} />
            <Row label="Subdomain" mono value={`${tenant.slug}.jeffistores.in`} />
            {tenant.custom_domain && <Row label="Custom domain" mono value={tenant.custom_domain} />}
            <div className="flex items-center justify-between gap-3">
              <span className="text-foreground-secondary">Status</span>
              <StatusPill status={tenant.status} />
            </div>
            <Row label="Created" value={created} />
          </InfoCard>

          <InfoCard title="Subscription">
            <Row label="Plan" value={<span className="capitalize font-semibold">{tenant.plan ?? '—'}</span>} />
            <Row label="Billing" value={<span className="capitalize">{tenant.billing_interval}</span>} />
            <Row label="Price" value={<span className="font-semibold">{priceLabel}</span>} />
            {renewalDate && <Row label="Renews" value={renewalDate} />}
          </InfoCard>

          <InfoCard title="Infrastructure">
            {isLive ? (
              <>
                <Field label="Storefront">
                  <a
                    href={storeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-accent-600 dark:text-accent-400 hover:underline break-all"
                  >
                    {tenant.slug}.jeffistores.in
                  </a>
                </Field>
                {tenant.rds_endpoint && (
                  <Field label="Database">
                    <span className="font-mono text-xs text-foreground break-all">{tenant.rds_endpoint}</span>
                  </Field>
                )}
                {tenant.s3_bucket && (
                  <Field label="Storage bucket">
                    <span className="font-mono text-xs text-foreground break-all">{tenant.s3_bucket}</span>
                  </Field>
                )}
                {tenant.region && (
                  <Field label="Region">
                    <span className="text-xs text-foreground">{tenant.region}</span>
                  </Field>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 text-center">
                <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin mb-2" />
                <p className="text-sm text-foreground-secondary">Provisioning in progress…</p>
                <p className="text-xs text-foreground-secondary mt-1">URLs will appear once live.</p>
              </div>
            )}
          </InfoCard>
        </div>

        {/* ── Subdomains ── */}
        <section className="rounded-2xl border border-border-default bg-surface-elevated p-6">
          <SectionHeading>Your subdomains</SectionHeading>
          <SubdomainList
            slug={tenant.slug}
            plan={tenant.plan}
            maxCustomDomains={tenant.max_custom_domains ?? 0}
            rdsReady={!!tenant.rds_endpoint}
          />
        </section>

        {/* ── Custom domains ── */}
        <CustomDomains tenantId={tenant.id} slug={tenant.slug} maxDomains={tenant.max_custom_domains ?? 0} />

        <DeliveryAccount tenantId={tenant.id} ownDelhivery={ownDelhivery} tokenConnected={delhiveryTokenConnected} />

        {/* ── Transactions + ledger tabs ── */}
        <section className="rounded-2xl border border-border-default bg-surface-elevated p-6">
          <StoreDashboardTabs
            transactions={billing.transactions}
            ledger={billing.ledger}
            balance={billing.balance}
            totals={billing.totals}
            subscriptionStatus={tenant.subscription_status}
            billingInterval={tenant.billing_interval}
            plan={tenant.plan}
            renewalDate={renewalDate}
            slug={tenant.slug}
            ownRazorpay={tenant.own_razorpay === true}
          />
        </section>
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-foreground-secondary uppercase tracking-widest mb-4">{children}</h2>
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
      <SectionHeading>{title}</SectionHeading>
      <div className="space-y-2.5 text-sm">{children}</div>
    </div>
  )
}

// A label→value line. Value is real data, so it renders in full foreground; the label in secondary.
function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground-secondary flex-shrink-0">{label}</span>
      <span className={`text-foreground text-right ${mono ? 'font-mono text-xs break-all' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  )
}

// Stacked label-over-value, for longer values (URLs, endpoints) that shouldn't be squeezed inline.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-foreground-secondary text-xs mb-1">{label}</div>
      {children}
    </div>
  )
}

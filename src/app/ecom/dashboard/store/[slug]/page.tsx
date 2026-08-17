import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { getOwnerTenants, getTenantBilling } from '@/lib/tenant-registry'
import { getSubscription } from '@/lib/razorpay-subscriptions'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import StoreDashboardTabs from '../StoreDashboardTabs'
import SubdomainList from '../SubdomainList'
import CustomDomains from '../CustomDomains'

export const dynamic = 'force-dynamic'

export default async function StoreDashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = { userAgent: h.get('user-agent'), acceptLanguage: h.get('accept-language'), uaPlatform: h.get('sec-ch-ua-platform') }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')

  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenants.find((t) => t.slug === slug)
  if (!tenant) redirect('/dashboard')
  // Not active yet — send back to onboard status screen
  if (tenant.status !== 'active') redirect('/onboard')

  const [billing, rzpSub] = await Promise.all([
    getTenantBilling(tenant.id),
    tenant.razorpay_subscription_id && tenant.subscription_status === 'active'
      ? getSubscription(tenant.razorpay_subscription_id).catch(() => null)
      : Promise.resolve(null),
  ])

  const renewalDate = rzpSub?.current_end
    ? new Date(rzpSub.current_end * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  const isLive = tenant.status === 'active'
  const monthly = Number(tenant.monthly_price_inr ?? 0)
  const price = tenant.billing_interval === 'yearly' ? monthly * 12 : monthly

  return (
    <div className="w-full min-h-screen bg-surface-secondary">
      {/* Top bar */}
      <div className="border-b border-border-default bg-surface-elevated px-6 lg:px-10 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-foreground-muted hover:text-foreground transition-colors">← Dashboard</Link>
            <span className="text-border-default">/</span>
            <h1 className="text-lg font-bold text-foreground">{tenant.display_name}</h1>
            <StatusPill status={tenant.status} />
          </div>
          <div className="flex gap-2">
            <Link href={`/dashboard/billing?tenant=${tenant.slug}`}
              className="px-4 py-2 rounded-lg border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors">
              Billing
            </Link>
            {isLive && (
              <a href={`https://${tenant.slug}.jeffistores.in`} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium transition-colors">
                Open store →
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 lg:px-10 py-8 space-y-6">
        {/* Store info cards row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Store identity */}
          <div className="lg:col-span-2 rounded-2xl border border-border-default bg-surface-elevated p-5">
            <div className="text-xs text-foreground-muted uppercase tracking-widest mb-3">Store identity</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-foreground-muted">Name</span>
                <span className="font-medium text-foreground">{tenant.display_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-muted">Subdomain</span>
                <span className="font-mono text-foreground text-xs">{tenant.slug}.jeffistores.in</span>
              </div>
              {tenant.custom_domain && (
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Custom domain</span>
                  <span className="font-mono text-foreground text-xs">{tenant.custom_domain}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-foreground-muted">Status</span>
                <StatusPill status={tenant.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-muted">Created</span>
                <span className="text-foreground">{new Date(tenant.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
            </div>
          </div>

          {/* Subscription */}
          <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
            <div className="text-xs text-foreground-muted uppercase tracking-widest mb-3">Subscription</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-foreground-muted">Plan</span>
                <span className="font-semibold text-foreground capitalize">{tenant.plan ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-muted">Billing</span>
                <span className="text-foreground capitalize">{tenant.billing_interval}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-muted">Price</span>
                <span className="text-foreground font-medium">
                  {price > 0 ? `₹${price.toLocaleString('en-IN')}/${tenant.billing_interval === 'yearly' ? 'yr' : 'mo'}` : '—'}
                </span>
              </div>
              {renewalDate && (
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Renews</span>
                  <span className="text-foreground">{renewalDate}</span>
                </div>
              )}
            </div>
          </div>

          {/* Infrastructure — only show provisioned URLs when active */}
          <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
            <div className="text-xs text-foreground-muted uppercase tracking-widest mb-3">Infrastructure</div>
            {isLive ? (
              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-foreground-muted text-xs mb-1">Storefront</div>
                  <a href={`https://${tenant.slug}.jeffistores.in`} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-xs text-accent-600 dark:text-accent-400 hover:underline break-all">
                    {tenant.slug}.jeffistores.in
                  </a>
                </div>
                {tenant.rds_endpoint && (
                  <div>
                    <div className="text-foreground-muted text-xs mb-1">Database</div>
                    <span className="font-mono text-xs text-foreground break-all">{tenant.rds_endpoint}</span>
                  </div>
                )}
                {tenant.s3_bucket && (
                  <div>
                    <div className="text-foreground-muted text-xs mb-1">Storage bucket</div>
                    <span className="font-mono text-xs text-foreground break-all">{tenant.s3_bucket}</span>
                  </div>
                )}
                {tenant.region && (
                  <div>
                    <div className="text-foreground-muted text-xs mb-1">Region</div>
                    <span className="text-xs text-foreground">{tenant.region}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 text-center">
                <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin mb-2" />
                <p className="text-xs text-foreground-muted">Provisioning in progress…</p>
                <p className="text-xs text-foreground-muted mt-1">URLs will appear once live.</p>
              </div>
            )}
          </div>
        </div>

        {/* Subdomains */}
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
          <div className="text-xs text-foreground-muted uppercase tracking-widest mb-4">Your subdomains</div>
          <SubdomainList
            slug={tenant.slug}
            plan={tenant.plan}
            maxCustomDomains={tenant.max_custom_domains ?? 0}
            rdsReady={!!tenant.rds_endpoint}
          />
        </div>

        {/* Custom domains */}
        <CustomDomains tenantId={tenant.id} slug={tenant.slug} maxDomains={tenant.max_custom_domains ?? 0} />

        {/* Transactions + ledger tabs */}
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
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
          />
        </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getTenantBilling, listPlans, controlPlanePool } from '@/lib/tenant-registry'
import { getSubscription } from '@controller/lib/payments/razorpay-subscriptions'
import { StatusPill } from '@controller/components/admin/ecom/EcomUI'
import SiteReachabilityBadge from './SiteReachabilityBadge'
import PageHeader from './_components/PageHeader'
import { Card, Row } from './_components/Card'
import SetupProgress from './_components/SetupProgress'
import { MoneyTiles, STATUS_PILL, fmt } from './_components/finance'
import AddStoreClient from './add-store/AddStoreClient'
import ServicesClient from './services/ServicesClient'
import { serviceStates } from '@controller/lib/ecom/service-states'
import { priceList } from '@jeffi/pricing'

export const dynamic = 'force-dynamic'

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })

  const [billing, rzpSub, services, plans, priceRow] = await Promise.all([
    getTenantBilling(tenant.id, { transactions: { limit: 5 }, ledger: { limit: 0 } }),
    tenant.razorpay_subscription_id && tenant.subscription_status === 'active'
      ? getSubscription(tenant.razorpay_subscription_id).catch(() => null)
      : Promise.resolve(null),
    serviceStates(tenant),
    listPlans('any').catch(() => []),
    controlPlanePool()
      .query<{ price: string | null }>(`SELECT price_inr_month AS price FROM tenant_compute WHERE tenant_id = $1`, [tenant.id])
      .catch(() => ({ rows: [] as { price: string | null }[] })),
  ])
  const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const renewalDate = rzpSub?.current_end ? fmtDay(new Date(rzpSub.current_end * 1000)) : null

  const isLive = tenant.status === 'active' && tenant.store_request !== 'provisioning'
  const isStore = (tenant.service_types ?? ['store']).includes('store')
  const storeUrl = `https://${tenant.slug}.jeffistores.in`
  // The subscription price: plan fee + servers + GST on servers (tenant_compute.price_inr_month). Yearly is 10× the month.
  const monthly = Number(priceRow.rows[0]?.price ?? 0)
  const price = Math.round(tenant.billing_interval === 'yearly' ? monthly * 10 : monthly)
  const priceLabel = price > 0 ? `₹${price.toLocaleString('en-IN')}/${tenant.billing_interval === 'yearly' ? 'yr' : 'mo'}` : '—'
  const planName = plans.find(p => p.slug === tenant.plan)?.name ?? tenant.plan ?? '—'
  // With payments off there is no subscription behind the store yet.
  const subStatus = tenant.razorpay_subscription_id ? tenant.subscription_status : 'Billing starts later'
  const ownRazorpay = tenant.own_razorpay === true

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={tenant.display_name}
        actions={
          <>
            <StatusPill status={tenant.status} />
            {isStore && isLive && <SiteReachabilityBadge url={storeUrl} />}
          </>
        }
      />

      <div className="space-y-6">
        {(!isStore || tenant.store_request) && <AddStoreClient tenant={tenant} />}

        <ServicesClient states={services} prices={priceList()} compact />

        <div
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            ownRazorpay ? 'bg-[var(--console-sage)] text-[var(--console-sage-deep)]' : 'bg-[var(--console-terracotta-soft)] ecom-accent-text'
          }`}
        >
          {ownRazorpay ? 'Collecting on your own Razorpay — no platform commission' : 'Platform Razorpay — Route settlement applies'}
        </div>

        <MoneyTiles balance={billing.balance} totals={billing.totals} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Store">
            <div className="space-y-2.5">
              <Row label="Subdomain" mono value={`${tenant.slug}.jeffistores.in`} />
              {tenant.custom_domain && <Row label="Custom domain" mono value={tenant.custom_domain} />}
              <Row label="Created" value={fmtDay(new Date(tenant.created_at))} />
              {tenant.region && <Row label="Region" value={tenant.region} />}
            </div>
            {isStore && !isLive && (
              <div className="mt-4">
                <SetupProgress tenantId={tenant.id} />
              </div>
            )}
          </Card>

          <Card title="Subscription">
            <div className="space-y-2.5">
              <Row label="Plan" value={<span className="font-semibold">{planName}</span>} />
              <Row label="Billing" value={<span className="capitalize">{tenant.billing_interval}</span>} />
              <Row label="Price" value={priceLabel} />
              <Row label="Status" value={<span className="capitalize">{subStatus}</span>} />
              {renewalDate && <Row label="Renews" value={renewalDate} />}
            </div>
            <Link href="/dashboard/billing" className="inline-block mt-4 text-sm font-semibold ecom-accent-text hover:underline">
              Manage billing →
            </Link>
          </Card>

          <Card title="Quick links">
            <ul className="space-y-2 text-sm">
              {(isStore
                ? [
                    ['/dashboard/domains', 'Domains & subdomains'],
                    ['/dashboard/delivery', 'Delivery account'],
                    ['/dashboard/payouts', 'Payout bank account'],
                    ['/dashboard/api-keys', 'API keys'],
                  ]
                : [
                    ['/dashboard/api-keys', 'API keys'],
                    ['/dashboard/wallet', 'Wallet & top-up'],
                    ['/dashboard/business', 'Business details'],
                  ]
              ).map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-foreground hover:ecom-accent-text hover:underline">
                    {label} →
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {billing.transactions.length > 0 && (
          <Card title="Recent transactions">
            <div className="-mx-6 -mb-6 border-t border-border-default">
              {billing.transactions.slice(0, 5).map((t, i) => (
                <div key={t.id} className={`flex items-center justify-between gap-3 px-6 py-3 text-sm ${i > 0 ? 'border-t border-border-default/60' : ''}`}>
                  <div className="min-w-0 break-words">
                    <span className="font-medium text-foreground">{t.order_ref ?? t.id.slice(0, 8)}</span>
                    <span className="ml-2 text-xs text-foreground-secondary">{t.is_cod ? 'COD' : t.gateway}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-foreground">{fmt(Number(t.tenant_share))}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PILL[t.status] ?? 'bg-surface-secondary text-foreground-muted'}`}>
                      {t.status}
                    </span>
                  </div>
                </div>
              ))}
              <Link href="/dashboard/transactions" className="block px-6 py-3 text-sm font-semibold ecom-accent-text hover:underline border-t border-border-default">
                View all transactions →
              </Link>
            </div>
          </Card>
        )}
      </div>
    </>
  )
}

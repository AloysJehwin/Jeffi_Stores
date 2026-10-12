import Link from 'next/link'
import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { getTenantBilling } from '@/lib/tenant-registry'
import { getSubscription } from '@/lib/payments/razorpay-subscriptions'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import SiteReachabilityBadge from './SiteReachabilityBadge'
import PageHeader from './_components/PageHeader'
import { Card, Row } from './_components/Card'
import { MoneyTiles, STATUS_PILL, fmt } from './_components/finance'

export const dynamic = 'force-dynamic'

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })

  const [billing, rzpSub] = await Promise.all([
    getTenantBilling(tenant.id),
    tenant.razorpay_subscription_id && tenant.subscription_status === 'active'
      ? getSubscription(tenant.razorpay_subscription_id).catch(() => null)
      : Promise.resolve(null),
  ])
  const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const renewalDate = rzpSub?.current_end ? fmtDay(new Date(rzpSub.current_end * 1000)) : null

  const isLive = tenant.status === 'active'
  const storeUrl = `https://${tenant.slug}.jeffistores.in`
  const monthly = Number(tenant.monthly_price_inr ?? 0)
  const price = tenant.billing_interval === 'yearly' ? monthly * 12 : monthly
  const priceLabel = price > 0 ? `₹${price.toLocaleString('en-IN')}/${tenant.billing_interval === 'yearly' ? 'yr' : 'mo'}` : '—'
  const ownRazorpay = tenant.own_razorpay === true

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={tenant.display_name}
        actions={
          <>
            <StatusPill status={tenant.status} />
            {isLive && <SiteReachabilityBadge url={storeUrl} />}
          </>
        }
      />

      <div className="space-y-6">
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
            {!isLive && (
              <div className="mt-4 flex items-center gap-2 text-sm text-foreground-secondary">
                <span className="w-4 h-4 border-2 border-[var(--console-terracotta)] border-t-transparent rounded-full animate-spin" />
                Provisioning in progress…
              </div>
            )}
          </Card>

          <Card title="Subscription">
            <div className="space-y-2.5">
              <Row label="Plan" value={<span className="capitalize font-semibold">{tenant.plan ?? '—'}</span>} />
              <Row label="Billing" value={<span className="capitalize">{tenant.billing_interval}</span>} />
              <Row label="Price" value={priceLabel} />
              <Row label="Status" value={<span className="capitalize">{tenant.subscription_status}</span>} />
              {renewalDate && <Row label="Renews" value={renewalDate} />}
            </div>
            <Link href="/dashboard/billing" className="inline-block mt-4 text-sm font-semibold ecom-accent-text hover:underline">
              Manage billing →
            </Link>
          </Card>

          <Card title="Quick links">
            <ul className="space-y-2 text-sm">
              {[
                ['/dashboard/domains', 'Domains & subdomains'],
                ['/dashboard/delivery', 'Delivery account'],
                ['/dashboard/payouts', 'Payout bank account'],
                ['/dashboard/business', 'Business details'],
              ].map(([href, label]) => (
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
                <div key={t.id} className={`flex items-center justify-between px-6 py-3 text-sm ${i > 0 ? 'border-t border-border-default/60' : ''}`}>
                  <div>
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

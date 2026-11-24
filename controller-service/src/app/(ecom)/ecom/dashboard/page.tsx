import Link from 'next/link'
import type { ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getTenantBilling, hasService, listPlans, controlPlanePool, type TenantRow } from '@/lib/tenant-registry'
import { loadSetupOutcome } from '@/lib/tenant-registry/provisioning'
import { getSubscription } from '@controller/lib/payments/razorpay-subscriptions'
import { getTenantWallet } from '@/lib/payments/wallet'
import { SHOWCASE_FREE_DAYS, SHOWCASE_PRICE_INR } from '@/lib/showcase/types'
import { StatusPill } from '@controller/components/admin/ecom/EcomUI'
import { loadKybView } from '@controller/lib/kyb/view'
import { ITEM_LABEL } from '@controller/lib/kyb/requirements'
import SiteReachabilityBadge from './SiteReachabilityBadge'
import PageHeader from './_components/PageHeader'
import { Card, Row, StatTile } from './_components/Card'
import SetupProgress from './_components/SetupProgress'
import StoreClosed from './_components/StoreClosed'
import { MoneyTiles, STATUS_PILL, fmt } from './_components/finance'
import AddStoreClient from './add-store/AddStoreClient'
import ServicesClient from './services/ServicesClient'
import type { KybGate } from './business/KybChecklist'
import { primaryBtn, secondaryBtn } from '../onboard/ui'
import { serviceStates, type ApiService, type ServiceState } from '@controller/lib/ecom/service-states'
import { REVIEW_TIME } from '@controller/lib/ecom/console-copy'
import { priceList } from '@jeffi/pricing'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard' }

const API_SERVICES = ['messaging', 'documents'] as const
const SERVICE_NAME: Record<ApiService, string> = { messaging: 'Messaging', documents: 'Documents' }
// As the service cards label them.
const SERVICE_STATUS: Record<ServiceState['status'], string> = { live: 'Live', pending: 'Awaiting approval', rejected: 'Not approved', off: 'Not added' }
const SERVICE_SENTENCE: Record<ServiceState['status'], string> = { live: 'is live', pending: 'is awaiting approval', rejected: 'was not approved', off: 'is not added' }
const INTERVAL: Record<string, string> = { monthly: 'Monthly', yearly: 'Yearly' }
const STORE_LINKS: [string, string][] = [
  ['/dashboard/domains', 'Domains & subdomains'],
  ['/dashboard/delivery', 'Delivery account'],
  ['/dashboard/payouts', 'Payout bank account'],
  ['/dashboard/api-keys', 'API keys'],
]
const linkCls = 'inline-block mt-4 text-sm font-semibold ecom-accent-text hover:underline'

const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : s)
const listOf = (xs: string[]) =>
  xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join('')

async function loadStore(tenant: TenantRow, ownerId: string, tenants: TenantRow[], isLive: boolean) {
  const [billing, rzpSub, plans, priceRow, outcome] = await Promise.all([
    getTenantBilling(tenant.id, { transactions: { limit: 5 }, ledger: { limit: 0 } }),
    tenant.razorpay_subscription_id && tenant.subscription_status === 'active'
      ? getSubscription(tenant.razorpay_subscription_id).catch(() => null)
      : Promise.resolve(null),
    listPlans('any').catch(() => []),
    controlPlanePool()
      .query<{ price: string | null }>(`SELECT price_inr_month AS price FROM tenant_compute WHERE tenant_id = $1`, [tenant.id])
      .catch(() => ({ rows: [] as { price: string | null }[] })),
    // Stopped or deprovisioned: say so and what comes next, never a finished build.
    isLive ? Promise.resolve(null) : loadSetupOutcome(tenant, ownerId, tenants).catch(() => null),
  ])
  return { kind: 'store' as const, billing, rzpSub, plans, monthly: Number(priceRow.rows[0]?.price ?? 0), outcome }
}

/** A workspace without a store: where its business verification stands, its API keys and 30 days of API use. */
async function loadWorkspace(tenant: TenantRow, ownerId: string) {
  const [kyb, usage] = await Promise.all([
    loadKybView(tenant, ownerId).catch(() => null),
    controlPlanePool()
      .query<{ keys: number; messages: number; documents: number; spend_paise: string }>(
        `SELECT (SELECT count(*)::int FROM api_keys WHERE tenant_id = $1 AND status = 'active') AS keys,
                COALESCE(SUM(u.messages), 0)::int AS messages, COALESCE(SUM(u.documents), 0)::int AS documents,
                COALESCE(SUM(u.spend_paise), 0)::bigint AS spend_paise
           FROM api_keys k JOIN api_key_usage_daily u ON u.api_key_id = k.id AND u.day >= CURRENT_DATE - 30
          WHERE k.tenant_id = $1`,
        [tenant.id]
      )
      .then(r => r.rows[0] ?? null)
      .catch(() => null),
  ])
  const gate: KybGate | null = kyb && { services: kyb.services, items: kyb.items }
  return { kind: 'workspace' as const, kyb: gate, usage }
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { owner, tenants, tenant } = await loadOwnerContext({ tenantSlug })
  const isLive = tenant.status === 'active' && tenant.store_request !== 'provisioning'
  const isStore = hasService(tenant, 'store')

  const [services, wallet, data] = await Promise.all([
    serviceStates(tenant),
    // The prepaid wallet, as the Wallet page reads it (the settlement ledger's balance is a different figure).
    getTenantWallet(tenant.id, 0).catch(() => null),
    isStore ? loadStore(tenant, owner.id, tenants, isLive) : loadWorkspace(tenant, owner.id),
  ])
  const storeUrl = `https://${tenant.slug}.jeffistores.in`
  const serviceCards = <ServicesClient states={services} prices={priceList()} compact kyb={data.kind === 'workspace' ? (data.kyb ?? undefined) : undefined} />

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
        {data.kind === 'store' ? (
          <StoreOverview tenant={tenant} isLive={isLive} data={data} balance={Number(wallet?.balance ?? 0)} serviceCards={serviceCards} />
        ) : (
          <WorkspaceOverview
            tenant={tenant}
            services={services}
            data={data}
            balance={Number(wallet?.balance ?? 0)}
            minBalance={Number(wallet?.minBalance ?? 0)}
            serviceCards={serviceCards}
          />
        )}
      </div>
    </>
  )
}

function StoreOverview({
  tenant,
  isLive,
  data,
  balance,
  serviceCards,
}: {
  tenant: TenantRow
  isLive: boolean
  data: Awaited<ReturnType<typeof loadStore>>
  balance: number
  serviceCards: ReactNode
}) {
  const { billing, rzpSub, plans, monthly, outcome } = data
  const renewalDate = rzpSub?.current_end ? fmtDay(new Date(rzpSub.current_end * 1000)) : null
  // The subscription price: plan fee + servers + GST on servers (tenant_compute.price_inr_month). Yearly is 10× the month.
  const price = Math.round(tenant.billing_interval === 'yearly' ? monthly * 10 : monthly)
  const priceLabel = price > 0 ? `₹${price.toLocaleString('en-IN')}/${tenant.billing_interval === 'yearly' ? 'yr' : 'mo'}` : '—'
  const planName = plans.find(p => p.slug === tenant.plan)?.name ?? tenant.plan ?? '—'
  // With payments off there is no subscription behind the store yet.
  const subStatus = tenant.razorpay_subscription_id ? sentence(tenant.subscription_status) : 'Billing starts later'
  const ownRazorpay = tenant.own_razorpay === true
  const building = tenant.status === 'provisioning' || tenant.store_request === 'provisioning'

  return (
    <>
      {/* The store's own next step leads: what stopped it, or how far its setup has got. */}
      {outcome ? (
        <Card>
          <StoreClosed outcome={outcome} slug={tenant.slug} />
        </Card>
      ) : (
        !isLive && (
          <Card title={building ? 'Setting up your store' : 'Store status'}>
            <SetupProgress tenantId={tenant.id} slug={tenant.slug} />
          </Card>
        )
      )}

      <div
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
          ownRazorpay ? 'bg-[var(--console-sage)] text-[var(--console-sage-deep)]' : 'bg-[var(--console-terracotta-soft)] ecom-accent-text'
        }`}
      >
        {ownRazorpay ? 'Collecting on your own Razorpay — no platform commission' : 'Platform Razorpay — Route settlement applies'}
      </div>

      <MoneyTiles balance={{ label: 'Wallet balance', value: balance }} totals={billing.totals} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Store">
          <div className="space-y-2.5">
            <Row label="Subdomain" mono value={`${tenant.slug}.jeffistores.in`} />
            {tenant.custom_domain && <Row label="Custom domain" mono value={tenant.custom_domain} />}
            <Row label="Created" value={fmtDay(new Date(tenant.created_at))} />
            {tenant.region && <Row label="Region" value={tenant.region} />}
          </div>
        </Card>

        <Card title="Subscription">
          <div className="space-y-2.5">
            <Row label="Plan" value={<span className="font-semibold">{planName}</span>} />
            <Row label="Billing" value={INTERVAL[tenant.billing_interval] ?? sentence(tenant.billing_interval)} />
            <Row label="Price" value={priceLabel} />
            <Row label="Status" value={subStatus} />
            {renewalDate && <Row label="Renews" value={renewalDate} />}
          </div>
          <Link href="/dashboard/billing" className={linkCls}>
            Manage billing →
          </Link>
        </Card>

        <Card title="Quick links">
          <QuickLinks links={STORE_LINKS} />
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

      {/* Messaging and Documents are add-ons here: offered after the store's own blocks. */}
      {serviceCards}
    </>
  )
}

interface Step {
  title: string
  detail: string
  done: boolean
  href: string
  cta: string
}

/** An API workspace's way to its first send: verified, a service on, money in the wallet, a key. */
function workspaceSteps(services: Record<ApiService, ServiceState>, kyb: KybGate | null, balance: number, minBalance: number, keys: number): Step[] {
  const added = API_SERVICES.filter(s => services[s].status !== 'off')
  const gates = kyb ? added.map(s => kyb.services[s]) : []
  // Nothing added yet: verified enough for at least one service.
  const verified = !!kyb && (added.length ? gates.every(g => g.ready) : API_SERVICES.some(s => kyb.services[s].ready))
  const todo = [...new Set(gates.flatMap(g => g.todo))].map(i => ITEM_LABEL[i])
  const requested = added.some(s => services[s].status !== 'rejected')
  const funded = balance > minBalance
  return [
    {
      title: 'Verify your business',
      detail: verified
        ? 'Your business details are in.'
        : todo.length
          ? `Still needed: ${listOf(todo)}.`
          : 'Jeffi checks your business before switching Messaging or Documents on.',
      done: verified,
      href: added.length === 1 ? `/dashboard/business?for=${added[0]}` : '/dashboard/business',
      cta: 'Verify business',
    },
    {
      title: 'Add a service',
      detail: added.length
        ? added.map(s => `${SERVICE_NAME[s]} ${SERVICE_SENTENCE[services[s].status]}.`).join(' ')
        : 'Messaging for WhatsApp, SMS and email, or Documents for GST invoices and PDFs.',
      done: requested,
      href: '/dashboard/services',
      cta: added.length && !requested ? 'Request again' : 'Choose a service',
    },
    {
      title: 'Top up your wallet',
      detail: funded
        ? `${fmt(balance)} available.`
        : balance > 0
          ? `${fmt(balance)} is below the ${fmt(minBalance)} minimum.`
          : 'Every message and document is paid from it.',
      done: funded,
      href: '/dashboard/wallet',
      cta: 'Top up wallet',
    },
    {
      title: 'Create an API key',
      detail: keys ? `${keys} active key${keys === 1 ? '' : 's'}.` : 'Your app sends with it.',
      done: keys > 0,
      href: '/dashboard/api-keys',
      cta: 'Create a key',
    },
  ]
}

function GetStarted({ steps }: { steps: Step[] }) {
  const next = steps.findIndex(s => !s.done)
  const done = steps.filter(s => s.done).length
  return (
    <Card title="Get started" action={<span className="text-xs font-medium tabular-nums text-foreground-muted">{done} of {steps.length} done</span>}>
      <ol className="-my-3 divide-y divide-border-default">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:flex-nowrap">
            {s.done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 org-sage-text" aria-hidden />
            ) : (
              <span
                aria-hidden
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                  i === next ? 'ecom-accent-bg text-white' : 'border border-border-default text-foreground-muted'
                }`}
              >
                {i + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${s.done ? 'text-foreground-secondary' : 'text-foreground'}`}>
                {s.done && <span className="sr-only">Done: </span>}
                {s.title}
              </p>
              <p className="text-sm text-foreground-secondary">{s.detail}</p>
            </div>
            {!s.done && (
              <Link href={s.href} className={`ml-9 shrink-0 sm:ml-0 ${i === next ? primaryBtn : 'text-sm font-semibold ecom-accent-text hover:underline'}`}>
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}

function WorkspaceOverview({
  tenant,
  services,
  data,
  balance,
  minBalance,
  serviceCards,
}: {
  tenant: TenantRow
  services: Record<ApiService, ServiceState>
  data: Awaited<ReturnType<typeof loadWorkspace>>
  balance: number
  minBalance: number
  serviceCards: ReactNode
}) {
  const hasShowcase = hasService(tenant, 'showcase')
  // A Showcase-only workspace's next step is its site, not the API.
  const showcaseOnly = hasShowcase && !API_SERVICES.some(s => hasService(tenant, s))
  const { usage } = data
  const steps = showcaseOnly ? [] : workspaceSteps(services, data.kyb, balance, minBalance, usage?.keys ?? 0)
  const ready = steps.every(s => s.done)
  const count = (n: number | undefined) => (usage ? (n ?? 0).toLocaleString('en-IN') : '—')
  const links: [string, string][] = [
    ...(hasShowcase ? [['/dashboard/showcase', 'Showcase sites'] as [string, string]] : []),
    ...(showcaseOnly ? [] : [['/dashboard/api-keys', 'API keys'] as [string, string]]),
    ['/dashboard/wallet', 'Wallet & top-up'],
    ['/dashboard/business', 'Business verification'],
  ]

  return (
    <>
      {!ready && <GetStarted steps={steps} />}
      {showcaseOnly && (
        <Card title="Your website">
          <p className="text-sm text-foreground-secondary">Edit your Showcase site, publish it and see the enquiries it brings in.</p>
          <Link href="/dashboard/showcase" className={`${primaryBtn} mt-4`}>
            Open your sites
          </Link>
        </Card>
      )}
      {/* A store application in progress: where it stands. */}
      {tenant.store_request && <AddStoreClient tenant={tenant} />}
      {!ready && serviceCards}

      {!showcaseOnly && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Wallet balance" value={fmt(balance)} accent />
          <StatTile label="Messages · 30 days" value={count(usage?.messages)} />
          <StatTile label="Documents · 30 days" value={count(usage?.documents)} />
          <StatTile label="Spent · 30 days" value={usage ? fmt(Number(usage.spend_paise) / 100) : '—'} />
        </div>
      )}

      {ready && serviceCards}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Workspace">
          <div className="space-y-2.5">
            {API_SERVICES.map(s => (
              <Row key={s} label={SERVICE_NAME[s]} value={SERVICE_STATUS[services[s].status]} />
            ))}
            {hasShowcase && <Row label="Showcase" value="Added" />}
            <Row label="Created" value={fmtDay(new Date(tenant.created_at))} />
          </div>
          <Link href="/dashboard/services" className={linkCls}>
            Manage services →
          </Link>
        </Card>

        <Card title="Billing">
          <div className="space-y-2.5">
            <Row label="Plan" value={<span className="font-semibold">Pay as you go</span>} />
            {showcaseOnly && <Row label="Wallet balance" value={fmt(balance)} />}
            {hasShowcase && <Row label="Showcase site" value={`₹${SHOWCASE_PRICE_INR}/mo`} />}
          </div>
          <p className="mt-3 text-sm text-foreground-secondary">
            No subscription. Messages and documents are charged from your wallet as you use them
            {hasShowcase ? `, and a Showcase site after its first ${SHOWCASE_FREE_DAYS} days free` : ''}.
          </p>
          <Link href="/dashboard/wallet" className={linkCls}>
            Top up your wallet →
          </Link>
        </Card>

        <Card title="Quick links">
          <QuickLinks links={links} />
        </Card>
      </div>

      {!tenant.store_request && (
        <Card title="Add an online store">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-xl text-sm text-foreground-secondary">
              Sell online from this workspace, with the same wallet, API keys and business details. We review a store application in {REVIEW_TIME}.
            </p>
            <Link href="/dashboard/add-store" className={secondaryBtn}>
              Add a store
            </Link>
          </div>
        </Card>
      )}
    </>
  )
}

function QuickLinks({ links }: { links: [string, string][] }) {
  return (
    <ul className="space-y-2 text-sm">
      {links.map(([href, label]) => (
        <li key={href}>
          <Link href={href} className="text-foreground hover:ecom-accent-text hover:underline">
            {label} →
          </Link>
        </li>
      ))}
    </ul>
  )
}

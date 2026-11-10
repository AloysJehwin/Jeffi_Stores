import type { ReactNode } from 'react'
import { Sk } from '@/components/admin/kit/skeleton'
import AccountMobileHeader, { AccountMobileTabBar } from '@/components/visitor/AccountMobileHeader'
import BusinessAccountMobileHeader, { BusinessAccountMobileTabBar } from '@/components/business/AccountMobileHeader'
import { AccountNavBar } from '@/components/visitor/AccountSidebar'

// Account-area loading screens. The account layouts already render the nav bar; these render the
// page's own mobile header (the real one: the user is known by the time they show) and the body.

type Portal = 'store' | 'business'

const CARD = 'bg-surface-elevated rounded-lg shadow-sm border border-border-default'
const TILE = 'bg-surface-elevated rounded-xl border border-border-default'
const XCARD = 'bg-surface-elevated rounded-xl shadow-sm border border-border-default p-5 sm:p-6'
const PILL_ON = 'px-3 py-1 rounded-full text-xs font-medium bg-accent-500 text-white'
const PILL = 'px-3 py-1 rounded-full text-xs font-medium bg-surface-elevated border border-border-default text-foreground-secondary'

export function AccountHeader({ portal = 'store' }: { portal?: Portal }) {
  return portal === 'business' ? <BusinessAccountMobileHeader /> : <AccountMobileHeader />
}

function Pills({ labels }: { labels: string[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {labels.map((l, i) => (
        <span key={l} className={i === 0 ? PILL_ON : PILL}>
          {l}
        </span>
      ))}
    </div>
  )
}

function Frame({ portal, label, className, children }: { portal: Portal; label: string; className: string; children: ReactNode }) {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label={label}>
      <AccountHeader portal={portal} />
      <div className={`container mx-auto px-4 ${className}`}>{children}</div>
    </div>
  )
}

/* ---------- /account ---------- */

function HeroStat({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <div className="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
      <span aria-hidden className={`sk block rounded bg-white/25 h-5 mx-auto ${wide ? 'w-14' : 'w-8'}`} />
      <p className="text-[10px] text-white/70 mt-1">{label}</p>
    </div>
  )
}

function DeskStat({ label, tone }: { label: string; tone: string }) {
  return (
    <div className={`${TILE} p-4 flex items-center gap-3`}>
      <div className={`w-9 h-9 rounded-lg flex-shrink-0 ${tone}`} />
      <div className="flex-1">
        <Sk className="h-5 w-12" />
        <p className="text-xs text-foreground-muted mt-1">{label}</p>
      </div>
    </div>
  )
}

function SectionHead({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {action && (
        <span className="text-xs text-accent-600 dark:text-accent-400 font-medium px-2.5 py-1 rounded-lg border border-accent-200 dark:border-accent-800">
          {action}
        </span>
      )}
    </div>
  )
}

/** Shimmer for one of the dashboard's recent orders. */
export function RecentOrderRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="flex -space-x-2 flex-shrink-0">
        <Sk className="w-10 h-10 rounded-lg" />
        <Sk className="w-10 h-10 rounded-lg" />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <Sk className="h-3 w-24" />
        <Sk className="h-4 w-3/4" />
        <Sk className="h-3 w-20" />
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <Sk className="h-4 w-14" />
        <Sk className="h-4 w-16 rounded-full" />
      </div>
    </div>
  )
}

/** Shimmer for the dashboard's default address. */
export function DefaultAddressSkeleton() {
  return (
    <div className="space-y-2">
      <Sk className="h-4 w-32" />
      <Sk className="h-3 w-3/4" />
      <Sk className="h-3 w-1/2" />
      <Sk className="h-3 w-24" />
    </div>
  )
}

/** /account: hero (phones), stats, Profile, Default Address and Recent Orders. */
export function AccountHomeSkeleton({ portal = 'store' }: { portal?: Portal }) {
  const store = portal === 'store'
  const profileRows = store ? ['Phone', 'Date of Birth', 'Member since'] : ['Phone', 'Member since']
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading account">
      <div className="bg-gradient-to-br from-accent-600 to-accent-500 dark:from-accent-700 dark:to-accent-600 px-4 pt-8 pb-14 lg:hidden">
        <div className="flex items-center gap-4">
          <span aria-hidden className="sk block w-16 h-16 rounded-2xl bg-white/20 flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <span aria-hidden className="sk block rounded bg-white/25 h-5 w-40" />
            <span aria-hidden className="sk block rounded bg-white/20 h-4 w-48 max-w-full" />
          </div>
          <span className="flex-shrink-0 w-8 h-8 rounded-xl bg-white/10" />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-5">
          <HeroStat label="Total Orders" />
          <HeroStat label="Total Spent" wide />
          <HeroStat label="Active" />
        </div>
      </div>
      <div className={`lg:hidden relative z-10 ${store ? '-mt-12' : '-mt-8'}`}>
        {store ? <AccountMobileTabBar /> : <BusinessAccountMobileTabBar />}
      </div>
      <div className={`container mx-auto px-4 ${store ? 'pb-8' : ''}`}>
        <div className={`${store ? 'pt-2 pb-4' : 'py-4 sm:py-6'} space-y-4 max-w-3xl lg:max-w-none`}>
          <div className="hidden lg:grid grid-cols-3 gap-3">
            <DeskStat label="Total Orders" tone="bg-accent-500/10" />
            <DeskStat label="Total Spent" tone="bg-green-500/10" />
            <DeskStat label="Active Orders" tone="bg-blue-500/10" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`${TILE} p-4 sm:p-5`}>
              <SectionHead title="Profile" action="Edit" />
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <Sk className="w-10 h-10 rounded-xl flex-shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Sk className="h-4 w-32" />
                    <Sk className="h-3 w-44 max-w-full" />
                  </div>
                </div>
                <div className="pt-2 border-t border-border-default space-y-2">
                  {profileRows.map(r => (
                    <div key={r} className="flex justify-between items-center">
                      <span className="text-xs text-foreground-muted">{r}</span>
                      <Sk className="h-3 w-24" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className={`${TILE} p-4 sm:p-5`}>
              <SectionHead title="Default Address" action="Manage" />
              <DefaultAddressSkeleton />
            </div>
          </div>
          <div className={`${TILE} p-4 sm:p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">Recent Orders</h2>
              <span className="text-xs text-accent-600 dark:text-accent-400 font-medium">View all</span>
            </div>
            <div className="space-y-2">
              <RecentOrderRowSkeleton />
              <RecentOrderRowSkeleton />
              <RecentOrderRowSkeleton />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- orders ---------- */

/** One order card: the compact phone card and the desktop card with its column labels. */
export function OrderCardSkeleton() {
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="sm:hidden">
        <div className="bg-surface border-b border-border-default px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <Sk className="h-4 w-32" />
            <Sk className="h-5 w-20 rounded-full" />
          </div>
          <Sk className="h-3 w-40" />
        </div>
        <div className="px-4 py-3">
          <div className="flex gap-3 items-center">
            <Sk className="w-12 h-12 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Sk className="h-4 w-3/4" />
              <Sk className="h-3 w-16" />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border-default">
            <span className="text-accent-600 dark:text-accent-400 font-medium text-sm">View Details</span>
          </div>
        </div>
      </div>
      <div className="hidden sm:block">
        <div className="bg-surface border-b border-border-default px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              {['Order Number', 'Order Date', 'Total'].map(l => (
                <div key={l}>
                  <p className="text-xs text-foreground-muted mb-1">{l}</p>
                  <Sk className="h-4 w-24" />
                </div>
              ))}
            </div>
            <Sk className="h-6 w-24 rounded-full" />
          </div>
        </div>
        <div className="p-6">
          <div className="flex gap-4">
            <Sk className="w-20 h-20 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <Sk className="h-4 w-3/4" />
              <Sk className="h-3.5 w-1/3" />
              <Sk className="h-4 w-20" />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border-default">
            <span className="text-accent-600 dark:text-accent-400 font-medium text-sm">View Order Details</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function OrderCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <OrderCardSkeleton key={i} />
      ))}
    </div>
  )
}

/** /account/orders; the portal's page puts a search box above the list. */
export function OrdersListSkeleton({ portal = 'store' }: { portal?: Portal }) {
  return (
    <Frame portal={portal} label="Loading orders" className="pt-4 pb-8">
      {portal === 'business' && (
        <div className="mb-4 hidden sm:block max-w-xs">
          <div className="relative w-full pl-9 pr-8 py-2 text-sm rounded-lg bg-surface-elevated border border-border-default text-foreground-muted">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Search orders…
          </div>
        </div>
      )}
      <OrderCardsSkeleton />
    </Frame>
  )
}

function Total({ label, value = 'w-20' }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between items-center text-sm text-foreground-secondary">
      <span>{label}</span>
      <Sk className={`h-4 ${value}`} />
    </div>
  )
}

/** /account/orders/[id]: order header, items with totals, and the address. */
export function OrderDetailSkeleton({ portal = 'store' }: { portal?: Portal }) {
  return (
    <Frame portal={portal} label="Loading order" className="pb-8">
      <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className={`${CARD} p-4 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-1 text-xl font-bold text-foreground">
                Order #<Sk className="inline-block h-6 w-36" />
              </h2>
              <div className="flex items-center gap-1 text-sm text-foreground-secondary mt-1">
                Placed on <Sk className="inline-block h-4 w-44" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Sk className="h-6 w-24 rounded-full" />
              <Sk className="h-6 w-28 rounded-full" />
            </div>
          </div>
        </div>
        <div className={`${CARD} p-4 sm:p-6`}>
          <h3 className="flex items-center gap-1 text-lg font-bold text-foreground mb-4">
            Order Items (<Sk className="inline-block h-5 w-14" />)
          </h3>
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0">
                <Sk className="w-20 h-20 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Sk className="h-4 w-3/4" />
                  <Sk className="h-3.5 w-1/4" />
                  <Sk className="h-4 w-24" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-4 border-t-2 border-border-default space-y-2">
            <Total label="Subtotal" />
            <div className="flex justify-between items-center pt-2">
              <span className="text-lg font-bold text-foreground">Total</span>
              <Sk className="h-7 w-28" />
            </div>
          </div>
        </div>
        <div className={`${CARD} p-4 sm:p-6`}>
          <Sk className="h-6 w-40 mb-4" />
          <div className="space-y-2">
            <Sk className="h-4 w-36" />
            <Sk className="h-4 w-3/4" />
            <Sk className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    </Frame>
  )
}

/* ---------- addresses, transactions, subscriptions ---------- */

/** /account/addresses: type filter, "+ Add New Address" and the address cards. */
export function AddressesSkeleton({ portal = 'store' }: { portal?: Portal }) {
  return (
    <Frame portal={portal} label="Loading addresses" className="pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Pills labels={['All', 'Shipping', 'Billing']} />
        <span className="px-5 py-2 bg-accent-600 text-white rounded-lg font-semibold text-sm">+ Add New Address</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={`${CARD} p-4 sm:p-6`}>
            <div className="mb-4 space-y-2">
              <Sk className="h-6 w-20 mb-3" />
              <Sk className="h-4 w-36" />
              <Sk className="h-4 w-3/4" />
              <Sk className="h-4 w-1/2" />
              <Sk className="h-4 w-28 mt-2" />
            </div>
            <div className="flex gap-2">
              <span className="px-4 py-2 bg-surface-secondary text-foreground-secondary rounded-lg text-sm font-medium">Edit</span>
              <span className="px-4 py-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium">
                Delete
              </span>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

/** /account/transactions: status filter and payment cards. */
export function TransactionsSkeleton({ portal = 'store' }: { portal?: Portal }) {
  return (
    <Frame portal={portal} label="Loading transactions" className="pt-4 pb-8">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Pills labels={['All', 'Completed', 'Pending', 'Failed', 'Refunded']} />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${CARD} p-4 sm:p-5`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Sk className="h-5 w-20 rounded-full" />
                  <Sk className="h-5 w-16 rounded-full" />
                </div>
                <div className="flex items-baseline gap-4">
                  <Sk className="h-6 w-24" />
                  <Sk className="h-4 w-28" />
                </div>
              </div>
              <div className="space-y-1.5 sm:items-end flex flex-col">
                <Sk className="h-4 w-24" />
                <Sk className="h-3.5 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

export function SubscriptionCardSkeleton() {
  return (
    <div className="bg-surface-elevated rounded-lg border border-border-default p-4 space-y-3">
      <div className="flex gap-3 items-start">
        <Sk className="w-16 h-16 rounded" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Sk className="h-4 w-40" />
            <Sk className="h-5 w-16 rounded-full" />
          </div>
          <Sk className="h-4 w-48 max-w-full" />
          <Sk className="h-4 w-32" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Sk className="h-8 w-16 rounded-lg" />
        <Sk className="h-8 w-28 rounded-lg" />
        <Sk className="h-8 w-16 rounded-lg" />
      </div>
    </div>
  )
}

/** /account/subscriptions. */
export function SubscriptionsSkeleton({ portal = 'store' }: { portal?: Portal }) {
  return (
    <Frame portal={portal} label="Loading subscriptions" className="pt-4 pb-8 space-y-4">
      <SubscriptionCardSkeleton />
      <SubscriptionCardSkeleton />
    </Frame>
  )
}

/* ---------- storefront-only account pages ---------- */

export function QuoteRowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="divide-y divide-border-default">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-5 space-y-2">
          <div className="flex items-center gap-2">
            <Sk className="h-4 w-32" />
            <Sk className="h-5 w-16 rounded-full" />
          </div>
          <Sk className="h-4 w-16" />
          <Sk className="h-3 w-28" />
        </div>
      ))}
    </div>
  )
}

/** /account/quotes (approved business buyers on the store). */
export function AccountQuotesSkeleton() {
  return (
    <div className="bg-surface min-h-screen py-6 lg:py-8" role="status" aria-busy="true" aria-label="Loading quotes">
      <div className="container mx-auto px-4 pb-8">
        <AccountMobileHeader />
        <div className={CARD}>
          <div className="px-6 py-4 border-b border-border-default">
            <p className="text-sm text-foreground-secondary">Track your RFQ submissions. Our team will review and respond.</p>
          </div>
          <QuoteRowsSkeleton />
        </div>
      </div>
    </div>
  )
}

function ListCard({ title, rows }: { title: string; rows: number }) {
  return (
    <div className={XCARD}>
      <h2 className="font-semibold text-foreground">{title}</h2>
      <ul className="mt-3 divide-y divide-border-default">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-4 py-3">
            <div className="space-y-1.5">
              <Sk className="h-4 w-44" />
              <Sk className="h-3 w-24" />
            </div>
            <Sk className="h-5 w-16 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The rewards body (tier, redeem, history; "How it works"), inside AccountRewards' container. */
export function RewardsBodySkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-border-default shadow-sm p-5 sm:p-6 bg-surface-elevated">
          <Sk className="h-6 w-28 rounded-full" />
          <Sk className="h-10 w-32 mt-4" />
          <Sk className="h-4 w-56 mt-2" />
          <Sk className="h-2 w-full rounded-full mt-5" />
          <Sk className="h-4 w-64 max-w-full mt-2" />
        </div>
        <div className={XCARD}>
          <h2 className="font-semibold text-foreground">Redeem points</h2>
          <Sk className="h-4 w-3/4 mt-2" />
          <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="sm:flex-1">
              <p className="block text-xs font-medium text-foreground-secondary mb-1">Points to redeem</p>
              <Sk className="h-10 w-full sm:w-40 rounded-lg" />
            </div>
            <Sk className="h-9 w-full sm:w-28 rounded-lg" />
          </div>
        </div>
        <ListCard title="Points history" rows={4} />
      </div>
      <div className="min-w-0 lg:sticky lg:top-4">
        <div className={XCARD}>
          <h2 className="font-semibold text-foreground">How it works</h2>
          <div className="mt-3 space-y-2">
            {['w-11/12', 'w-4/5', 'w-2/3', 'w-full'].map((w, i) => (
              <Sk key={i} className={`h-4 ${w}`} />
            ))}
          </div>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="py-2 pr-4 font-medium">Tier</th>
                <th className="py-2 pr-4 font-medium">Points needed</th>
                <th className="py-2 font-medium">Earning rate</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-t border-border-default">
                  <td className="py-2 pr-4">
                    <Sk className="h-5 w-16 rounded-full" />
                  </td>
                  <td className="py-2 pr-4">
                    <Sk className="h-4 w-12" />
                  </td>
                  <td className="py-2">
                    <Sk className="h-4 w-8" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** The referrals body (share card, stats, friends; "How it works"), inside AccountReferrals' container. */
export function ReferralsBodySkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-border-default shadow-sm bg-gradient-to-br from-accent-100 to-accent-50 dark:from-accent-900/40 dark:to-accent-800/20 p-4 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-300">Refer &amp; Earn</p>
          <span aria-hidden className="sk block rounded bg-white/60 dark:bg-white/10 h-7 w-72 max-w-full mt-2" />
          <p className="mt-2 text-sm text-foreground-secondary">
            When a friend signs up with your link and their first order is delivered, the points are yours.
          </p>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface-elevated border border-border-default pl-3 pr-1.5 py-1.5">
            <Sk className="flex-1 h-4" />
            <span className="shrink-0 inline-flex items-center px-2.5 py-1.5 rounded-md border border-border-default text-xs sm:text-sm font-medium text-foreground-secondary">
              Copy
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
            <span className="inline-flex items-center justify-center px-3 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium">
              WhatsApp
            </span>
            <span className="inline-flex items-center justify-center px-3 py-2.5 rounded-lg bg-accent-500 text-white text-sm font-medium">
              Share
            </span>
          </div>
          <p className="mt-3 flex items-center gap-1 text-xs text-foreground-muted">
            Or share your code <Sk className="inline-block h-5 w-20" />
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl border border-border-default bg-border-default overflow-hidden">
          {['Friends joined', 'Rewarded', 'Points earned', 'Left this year'].map(l => (
            <div key={l} className="bg-surface-elevated px-4 py-3">
              <Sk className="h-6 w-10 mb-1" />
              <p className="text-xs text-foreground-secondary">{l}</p>
            </div>
          ))}
        </div>
        <ListCard title="Your friends" rows={3} />
      </div>
      <div className="min-w-0 lg:sticky lg:top-4">
        <div className={XCARD}>
          <h2 className="font-semibold text-foreground">How it works</h2>
          <ol className="mt-3 space-y-3">
            {[1, 2, 3].map(n => (
              <li key={n} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
                  {n}
                </span>
                <Sk className="h-4 flex-1 mt-1" />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

/** /account/rewards and /account/referrals: the mobile header, then the body. */
export function LoyaltySkeleton({ kind }: { kind: 'rewards' | 'referrals' }) {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label={`Loading ${kind}`}>
      <AccountMobileHeader />
      <div className="container mx-auto px-4 pt-4 pb-10">
        {kind === 'rewards' ? <RewardsBodySkeleton /> : <ReferralsBodySkeleton />}
      </div>
    </div>
  )
}

/** /wishlist: it sits outside the account layout, so it brings the nav bar itself. */
export function WishlistSkeleton() {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading wishlist">
      <div className="hidden lg:block">
        <AccountNavBar />
      </div>
      <AccountMobileHeader />
      <div className="container mx-auto px-4 py-4 sm:py-6">
        <div className="mb-4">
          <Pills labels={['All', 'In Stock', 'Out of Stock']} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`${CARD} overflow-hidden`}>
              <Sk className="aspect-[5/3] mx-3 mt-3 rounded-lg" />
              <div className="p-4 flex flex-col">
                <div className="min-h-[3rem] mb-2 space-y-1.5">
                  <Sk className="h-4 w-11/12" />
                  <Sk className="h-4 w-1/2" />
                </div>
                <Sk className="h-6 w-24 mb-1" />
                <p className="text-[10px] text-foreground-muted mb-3">Inclusive of all taxes</p>
                <Sk className="h-3.5 w-14 mb-3" />
                <Sk className="h-9 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

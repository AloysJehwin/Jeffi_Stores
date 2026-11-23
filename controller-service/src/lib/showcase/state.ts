import 'server-only'
import { getWalletBalance, isFlagshipTenant } from '@/lib/payments/wallet'
import { countUnreadShowcaseLeads, getShowcaseByOwner, getShowcaseByTenant, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { showcaseHost, showcaseUrl } from '@/lib/showcase/host'
import type { ShowcaseStatus } from '@/lib/showcase/types'
import { showcaseBilling, showcaseLine, showcaseWalletTenant, type ShowcaseBilling } from './billing'
import { currentSubscription } from '@controller/lib/billing/subscription'

/** What the console's Showcase page and its API show. */
export interface ShowcaseConsoleState extends ShowcaseBilling {
  id: string
  slug: string
  name: string
  status: ShowcaseStatus
  pauseReason: 'owner' | 'unpaid' | null
  host: string
  url: string
  hasPage: boolean
  publishedAt: string | null
  paidUntil: string | null
  renew: boolean
  lastChargeError: string | null
  /** The paying workspace's balance; null for the platform's own. */
  balanceInr: number | null
  unreadLeads: number
  /** The workspace's subscription status (created, active, pending, halted, ...); null when it has none. */
  subscriptionStatus: string | null
}

/** The workspace's site, else the owner's (the builder keeps one Showcase per owner). */
export async function consoleShowcase(ownerId: string, tenantId: string): Promise<ShowcaseSiteRow | null> {
  return (await getShowcaseByTenant(tenantId)) ?? (await getShowcaseByOwner(ownerId))
}

export async function showcaseConsoleState(site: ShowcaseSiteRow): Promise<ShowcaseConsoleState> {
  const tenantId = await showcaseWalletTenant(site)
  const [balanceInr, unreadLeads, line, sub] = await Promise.all([
    tenantId && !isFlagshipTenant(tenantId) ? getWalletBalance(tenantId).then(b => b.balance).catch(() => null) : Promise.resolve(null),
    countUnreadShowcaseLeads(site.id).catch(() => 0),
    showcaseLine(site),
    tenantId ? currentSubscription(tenantId).catch(() => null) : Promise.resolve(null),
  ])
  return {
    ...showcaseBilling(site, line),
    subscriptionStatus: sub?.status ?? null,
    id: site.id,
    slug: site.slug,
    name: site.business.name?.trim() || 'Your site',
    status: site.status,
    pauseReason: site.pauseReason,
    host: showcaseHost(site.slug),
    url: showcaseUrl(site.slug),
    hasPage: !!site.page,
    publishedAt: site.publishedAt,
    paidUntil: site.paidUntil,
    renew: site.renew,
    lastChargeError: site.lastChargeError,
    balanceInr,
    unreadLeads,
  }
}

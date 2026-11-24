import 'server-only'
import { countUnreadShowcaseLeads, listShowcasesByOwner, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { getOwnerTenants, hasService, listPlans } from '@/lib/tenant-registry'
import { showcaseHost, showcasePreviewUrl, showcaseUrl } from '@/lib/showcase/host'
import type { ShowcaseStatus } from '@/lib/showcase/types'
import { showcaseBilling, showcaseLine, showcaseWalletTenant, type ShowcaseBilling } from './billing'
import { currentSubscription, getBillingSubscription, isPaying } from '@controller/lib/billing/subscription'

/** What the console's Showcase page and its API show. */
export interface ShowcaseConsoleState extends ShowcaseBilling {
  id: string
  slug: string
  name: string
  status: ShowcaseStatus
  pauseReason: 'owner' | 'unpaid' | null
  host: string
  url: string
  /** The address as the console opens it for the owner (their own look isn't counted as a visit). */
  previewUrl: string
  hasPage: boolean
  publishedAt: string | null
  paidUntil: string | null
  renew: boolean
  lastChargeError: string | null
  unreadLeads: number
  /** The workspace's subscription status (created, active, pending, halted, ...); null when it has none. */
  subscriptionStatus: string | null
  /** An authorised subscription charges for it (not one still waiting for approval, nor an ending line). */
  autopay: boolean
  /** Autopay the owner started but hasn't approved yet. */
  checkoutUrl: string | null
  /** An ending line's last day (autopay turned off). */
  endsAt: string | null
  /** A halted subscription's or a wallet line's deadline. */
  graceUntil: string | null
}

export interface StorePlanOffer {
  slug: string
  name: string
  priceInr: number
}

/** The store plans a Showcase owner can move up to; null once they have (or asked for) a store. */
export async function storePlanOffers(ownerId: string): Promise<StorePlanOffer[] | null> {
  const tenants = (await getOwnerTenants(ownerId).catch(() => [])).filter(t => t.status !== 'terminated')
  if (tenants.some(t => hasService(t, 'store') || t.store_request)) return null
  const plans = await listPlans().catch(() => [])
  return plans.map(p => ({ slug: p.slug, name: p.name, priceInr: Number(p.monthly_price_inr) }))
}

/** The sites the console lists: the owner's, newest first, whichever workspace pays (a site's pages check ownership). */
export const consoleShowcases = (ownerId: string): Promise<ShowcaseSiteRow[]> => listShowcasesByOwner(ownerId)

export async function showcaseConsoleState(site: ShowcaseSiteRow): Promise<ShowcaseConsoleState> {
  const tenantId = await showcaseWalletTenant(site)
  const [unreadLeads, line, sub] = await Promise.all([
    countUnreadShowcaseLeads(site.id).catch(() => 0),
    showcaseLine(site),
    tenantId ? currentSubscription(tenantId).catch(() => null) : Promise.resolve(null),
  ])
  const lineSub = line?.subscriptionId ? (line.subscriptionId === sub?.id ? sub : await getBillingSubscription(line.subscriptionId).catch(() => null)) : null
  return {
    ...showcaseBilling(site, line),
    subscriptionStatus: sub?.status ?? null,
    autopay: isPaying(lineSub) && line?.status !== 'ending',
    checkoutUrl: lineSub?.status === 'created' ? lineSub.checkoutUrl : null,
    endsAt: line?.endsAt ?? null,
    graceUntil: line?.graceUntil ?? sub?.graceUntil ?? null,
    id: site.id,
    slug: site.slug,
    name: site.business.name?.trim() || 'Your site',
    status: site.status,
    pauseReason: site.pauseReason,
    host: showcaseHost(site.slug),
    url: showcaseUrl(site.slug),
    previewUrl: showcasePreviewUrl(site.slug),
    hasPage: !!site.page,
    publishedAt: site.publishedAt,
    paidUntil: site.paidUntil,
    renew: site.renew,
    lastChargeError: site.lastChargeError,
    unreadLeads,
  }
}

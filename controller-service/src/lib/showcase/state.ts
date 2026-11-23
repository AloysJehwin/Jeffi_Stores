import 'server-only'
import { getWalletBalance, isFlagshipTenant } from '@/lib/payments/wallet'
import { countUnreadShowcaseLeads, listShowcasesByOwner, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { showcaseHost, showcasePreviewUrl, showcaseUrl } from '@/lib/showcase/host'
import type { ShowcaseStatus } from '@/lib/showcase/types'
import { showcaseBilling, showcaseWalletTenant, type ShowcaseBilling } from './billing'

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
  /** The paying workspace's balance; null for the platform's own. */
  balanceInr: number | null
  unreadLeads: number
}

/** The sites the console lists: the owner's, newest first, whichever workspace pays (a site's pages check ownership). */
export const consoleShowcases = (ownerId: string): Promise<ShowcaseSiteRow[]> => listShowcasesByOwner(ownerId)

export async function showcaseConsoleState(site: ShowcaseSiteRow): Promise<ShowcaseConsoleState> {
  const tenantId = await showcaseWalletTenant(site)
  const [balanceInr, unreadLeads] = await Promise.all([
    tenantId && !isFlagshipTenant(tenantId) ? getWalletBalance(tenantId).then(b => b.balance).catch(() => null) : Promise.resolve(null),
    countUnreadShowcaseLeads(site.id).catch(() => 0),
  ])
  return {
    ...showcaseBilling(site),
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
    balanceInr,
    unreadLeads,
  }
}

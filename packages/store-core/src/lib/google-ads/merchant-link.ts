import { getMerchantId, merchantApiRequest } from '@/lib/merchant/client'
import type { GoogleAdsClient } from './client'
import { GoogleAdsApiError } from './client'
import { runLoggedCall, type ChangeActor } from './mutate'

// Shopping and Performance Max need the store's Merchant Center account linked to the Ads account.
// Link order: accept an invitation Merchant Center already sent; else link directly
// (ProductLinkService, needs admin access to both accounts); else propose the link from Merchant
// Center (Merchant API accounts.services:propose) and accept it from the Ads side.

export interface MerchantLinkStatus {
  /** The store's Merchant Center id, or null when Merchant Center is not connected. */
  merchantId: string | null
  linked: boolean
  linkedIds: string[]
  pending: { resourceName: string; merchantId: string; status: string }[]
}

export const Q_LINKS = `SELECT product_link.resource_name, product_link.merchant_center.merchant_center_id, product_link.type
  FROM product_link WHERE product_link.type = 'MERCHANT_CENTER'`
export const Q_INVITES = `SELECT product_link_invitation.resource_name, product_link_invitation.merchant_center.merchant_center_id,
  product_link_invitation.status FROM product_link_invitation WHERE product_link_invitation.type = 'MERCHANT_CENTER'`

export async function merchantLinkStatus(ads: GoogleAdsClient, merchantId?: string | null): Promise<MerchantLinkStatus> {
  const mc = merchantId === undefined ? await getMerchantId().catch(() => null) : merchantId
  const [links, invites] = await Promise.all([ads.searchStream(Q_LINKS), ads.searchStream(Q_INVITES)])
  const linkedIds = links.map(r => String(r.productLink?.merchantCenter?.merchantCenterId ?? '')).filter(Boolean)
  const pending = invites
    .map(r => ({
      resourceName: String(r.productLinkInvitation?.resourceName ?? ''),
      merchantId: String(r.productLinkInvitation?.merchantCenter?.merchantCenterId ?? ''),
      status: String(r.productLinkInvitation?.status ?? ''),
    }))
    .filter(p => p.resourceName && p.status !== 'ACCEPTED')
  return { merchantId: mc ? String(mc) : null, linked: !!mc && linkedIds.includes(String(mc)), linkedIds, pending }
}

export interface LinkOutcome {
  status: 'linked' | 'accepted' | 'invited' | 'already'
  message: string
}

const PERMISSION = /PERMISSION|NOT_ALLOWED|ACTION_NOT_PERMITTED|AUTHORIZATION|USER_PERMISSION_DENIED|NOT_ADMIN/

async function acceptPending(ads: GoogleAdsClient, mc: string): Promise<boolean> {
  const s = await merchantLinkStatus(ads, mc)
  const invite = s.pending.find(p => p.merchantId === mc && p.status === 'PENDING_APPROVAL')
  if (!invite) return false
  await ads.post('/productLinkInvitations:update', { resourceName: invite.resourceName, productLinkInvitationStatus: 'ACCEPTED' })
  return true
}

export async function linkMerchantCenter(ads: GoogleAdsClient, actor: ChangeActor): Promise<LinkOutcome> {
  const mc = await getMerchantId().catch(() => null)
  if (!mc) throw new Error('Connect Google Merchant Center for this store first (Integrations).')
  const meta = {
    action: 'merchant.link' as const,
    entityType: 'merchant_link' as const,
    entityId: String(mc),
    summary: `Linked Merchant Center ${mc} to Google Ads`,
    request: { merchantId: String(mc), customerId: ads.customerId },
  }
  const before = await merchantLinkStatus(ads, mc)
  if (before.linked) return { status: 'already', message: 'Merchant Center is already linked.' }

  const { value } = await runLoggedCall<LinkOutcome>(meta, actor, async () => {
    if (await acceptPending(ads, mc)) return { status: 'accepted', message: 'Accepted the link request from Merchant Center.' }
    try {
      await ads.post('/productLinks:create', { productLink: { merchantCenter: { merchantCenterId: String(mc) } } })
      return { status: 'linked', message: 'Merchant Center is now linked.' }
    } catch (e) {
      const permission = e instanceof GoogleAdsApiError && (e.httpStatus === 403 || e.codes.some(c => PERMISSION.test(c)))
      if (!permission) throw e
    }
    // The signed-in user is not an admin of both accounts: ask from the Merchant Center side.
    await merchantApiRequest('POST', `/accounts/v1/accounts/${mc}/services:propose`, {
      body: { provider: 'providers/GOOGLE_ADS', accountService: { campaignsManagement: {}, externalAccountId: ads.customerId } },
    })
    if (await acceptPending(ads, mc).catch(() => false)) {
      return { status: 'accepted', message: 'Sent the link request from Merchant Center and accepted it in Google Ads.' }
    }
    return {
      status: 'invited',
      message: 'Link request sent from Merchant Center. Accept it in Google Ads under Tools > Data manager > Linked accounts, then refresh.',
    }
  })
  return value
}

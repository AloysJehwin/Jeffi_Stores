import { resolveGoogleMerchantCreds, resolveAmazonCreds } from './resolve'
import { merchantApiRequest } from '@/lib/merchant/client'
import { spApiRequest } from '@/lib/amazon/client'
import { getTenantSocialAccounts } from '@/lib/tenant-registry'
import { decryptToken } from '@/lib/crypto/token-cipher'
import { getPageInfo } from '@/lib/catalog/meta'

// "Test connection" for the store-admin credentials popup: one cheap authenticated read per
// provider using the stored credentials, so a bad key shows up before a sync or post fails.

export interface ConnectionTestResult {
  ok: boolean
  message: string
}

function failure(e: unknown): ConnectionTestResult {
  const msg = String((e as any)?.message || e || 'Unknown error')
  return { ok: false, message: msg.replace(/\s+/g, ' ').slice(0, 400) }
}

export async function testGoogleMerchant(): Promise<ConnectionTestResult> {
  try {
    const creds = await resolveGoogleMerchantCreds()
    const acct = await merchantApiRequest('GET', `/accounts/v1/accounts/${creds.merchantId}`, { delays: [] })
    const name = acct?.accountName ? `${acct.accountName} (${creds.merchantId})` : creds.merchantId
    return { ok: true, message: `Reached Merchant Center account ${name}.` }
  } catch (e) {
    return failure(e)
  }
}

export async function testAmazonSeller(): Promise<ConnectionTestResult> {
  try {
    const creds = await resolveAmazonCreds()
    const data = await spApiRequest('GET', '/sellers/v1/marketplaceParticipations')
    const ids: string[] = (data?.payload ?? []).map((p: any) => p?.marketplace?.id).filter(Boolean)
    if (ids.length && !ids.includes(creds.marketplaceId)) {
      return {
        ok: false,
        message: `Signed in, but the seller does not participate in marketplace ${creds.marketplaceId} (has ${ids.join(', ')}).`,
      }
    }
    return { ok: true, message: `Reached Amazon seller ${creds.sellerId || '(unknown id)'} on ${creds.marketplaceId}.` }
  } catch (e) {
    return failure(e)
  }
}

export async function testMeta(tenantId: string): Promise<ConnectionTestResult> {
  try {
    const accounts = await getTenantSocialAccounts(tenantId)
    const fb = accounts.find(a => a.provider === 'facebook') ?? accounts[0]
    if (!fb?.page_id) return { ok: false, message: 'Meta is not connected.' }
    const page = await getPageInfo(fb.page_id, decryptToken(fb.access_token_enc))
    const ig = accounts.find(a => a.provider === 'instagram')
    const igNote = ig
      ? page.igUserId === ig.ig_user_id
        ? ' Instagram linked.'
        : ' Instagram link changed; reconnect.'
      : ''
    return { ok: true, message: `Reached Facebook Page ${page.pageName || page.pageId}.${igNote}` }
  } catch (e) {
    return failure(e)
  }
}

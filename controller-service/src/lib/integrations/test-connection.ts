import { resolveGoogleMerchantCreds, resolveAmazonCreds } from './resolve'
import { merchantApiRequest } from '@/lib/merchant/client'
import { spApiRequest } from '@/lib/amazon/client'
import { getTenantSocialAccounts } from '@/lib/tenant-registry'
import { decryptToken } from '@/lib/crypto/token-cipher'
import { getPageInfo } from '@/lib/catalog/meta'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { verifyAccount } from '@/lib/google-ads/accounts'
import { formatCustomerId } from '@/lib/google-ads/client'

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

export async function testGoogleAds(tenantId?: string | null): Promise<ConnectionTestResult> {
  try {
    const client = await googleAdsClientFor(tenantId, { retryDelays: [] })
    const info = await verifyAccount(client)
    const via = client.loginCustomerId ? ` through manager ${formatCustomerId(client.loginCustomerId)}` : ''
    const test = info.test_account ? ' (test account)' : ''
    return {
      ok: true,
      message: `Reached Google Ads account ${info.descriptive_name || ''} ${formatCustomerId(info.customer_id)}${test}${via}.`.replace(/\s+/g, ' '),
    }
  } catch (e) {
    return failure(e)
  }
}

/** Live check of a Razorpay key pair: one authenticated read. Mode comes from the key's prefix. */
export async function verifyRazorpayKeys(keyId: string, keySecret: string): Promise<ConnectionTestResult> {
  if (!/^rzp_(live|test)_[A-Za-z0-9]+$/.test(keyId)) return { ok: false, message: 'The key id should look like rzp_live_… or rzp_test_….' }
  try {
    const { default: Razorpay } = await import('razorpay')
    await new Razorpay({ key_id: keyId, key_secret: keySecret }).payments.all({ count: 1 })
    return { ok: true, message: `Reached Razorpay with ${keyId.startsWith('rzp_live_') ? 'live' : 'test'} keys.` }
  } catch (e: any) {
    const status = Number(e?.statusCode ?? e?.status)
    if (status === 401) return { ok: false, message: 'Razorpay rejected these keys. Check the key id and secret.' }
    return failure(e?.error?.description ?? e)
  }
}

/** The store's Razorpay keys (its own, or the platform's) against Razorpay. */
export async function testRazorpay(tenantId?: string): Promise<ConnectionTestResult> {
  try {
    const { resolveRazorpayCreds } = await import('./resolve')
    const creds = await resolveRazorpayCreds(tenantId)
    if (!creds.key_id || !creds.key_secret) return { ok: false, message: 'No Razorpay keys are set.' }
    return verifyRazorpayKeys(creds.key_id, creds.key_secret)
  } catch (e) {
    return failure(e)
  }
}

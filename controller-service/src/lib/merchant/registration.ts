import { MERCHANT_API, getAccessToken, getMerchantId } from './client'

// Merchant API developer registration: a one-time link between our Google Cloud project and a
// Merchant Center account, required before any Merchant API call works for that account. It must be
// made by a user who is directly on the account (a Google sign-in, not the platform service
// account), and Google only allows it for production accounts with a verified website.

export interface RegistrationResult {
  ok: boolean
  message: string
}

function explain(status: number, msg: string): string {
  if (/verif/i.test(msg)) return `Google needs the account's website to be verified and claimed in Merchant Center first (${msg}).`
  if (/test account/i.test(msg)) return `Google does not allow this for test accounts (${msg}).`
  if (status === 401 || status === 403) return `The signed-in Google account is not an admin directly on this Merchant Center account (${msg}).`
  return msg
}

export async function registerMerchantApi(accessToken: string, merchantId: string, developerEmail?: string | null): Promise<RegistrationResult> {
  const res = await fetch(`${MERCHANT_API}/accounts/v1/accounts/${encodeURIComponent(merchantId)}/developerRegistration:registerGcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(developerEmail ? { developerEmail } : {}),
  }).catch(() => null)
  if (!res) return { ok: false, message: 'Could not reach Google.' }
  if (res.ok) return { ok: true, message: `Merchant API sync enabled for account ${merchantId}.` }
  const body: any = await res.json().catch(() => ({}))
  const msg = String(body?.error?.message ?? `HTTP ${res.status}`).replace(/\s+/g, ' ').slice(0, 300)
  // Already registered counts as success.
  if (res.status === 409 || /already/i.test(msg)) return { ok: true, message: `Merchant API sync was already enabled for account ${merchantId}.` }
  return { ok: false, message: explain(res.status, msg) }
}

/** Register the current owner's connected account (store, or the flagship's own connection). */
export async function registerConnectedMerchant(): Promise<RegistrationResult> {
  try {
    const [token, merchantId] = await Promise.all([getAccessToken(), getMerchantId()])
    return await registerMerchantApi(token, merchantId)
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? 'Google Merchant is not connected.') }
  }
}

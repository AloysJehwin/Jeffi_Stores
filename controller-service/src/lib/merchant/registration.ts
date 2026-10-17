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

const API_DEVELOPER = 'API_DEVELOPER'

async function call(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).catch(() => null)
  if (!res) return { ok: false, status: 0, body: null as any, msg: 'Could not reach Google.' }
  const json: any = await res.json().catch(() => ({}))
  const msg = String(json?.error?.message ?? `HTTP ${res.status}`).replace(/\s+/g, ' ').slice(0, 300)
  return { ok: res.ok, status: res.status, body: json, msg }
}

/** Give `email` the API developer role on the account, keeping its other access rights. */
async function grantApiDeveloper(token: string, merchantId: string, email: string): Promise<RegistrationResult> {
  const name = `accounts/${encodeURIComponent(merchantId)}/users/${encodeURIComponent(email)}`
  const cur = await call('GET', `${MERCHANT_API}/accounts/v1/${name}`, token)
  if (!cur.ok) return { ok: false, message: explain(cur.status, cur.msg) }
  const rights: string[] = Array.isArray(cur.body?.accessRights) ? cur.body.accessRights : []
  if (cur.body?.state && cur.body.state !== 'VERIFIED') {
    return { ok: false, message: `${email} has not accepted the Merchant Center invitation yet; the API developer must be a verified user.` }
  }
  if (rights.includes(API_DEVELOPER)) return { ok: true, message: `${email} already has the API developer role on ${merchantId}.` }
  const upd = await call('PATCH', `${MERCHANT_API}/accounts/v1/${name}?updateMask=accessRights`, token, { accessRights: [...rights, API_DEVELOPER] })
  return upd.ok
    ? { ok: true, message: `Merchant API sync enabled: ${email} is now the API developer on ${merchantId}.` }
    : { ok: false, message: explain(upd.status, upd.msg) }
}

/** Register our Cloud project with the account and make `developerEmail` its API developer. Google
 * requires a verified user with that role before the Merchant API accepts calls for the account. */
export async function registerMerchantApi(accessToken: string, merchantId: string, developerEmail?: string | null): Promise<RegistrationResult> {
  const email = developerEmail?.trim() || null
  const reg = await call(
    'POST',
    `${MERCHANT_API}/accounts/v1/accounts/${encodeURIComponent(merchantId)}/developerRegistration:registerGcp`,
    accessToken,
    email ? { developerEmail: email } : {}
  )
  const already = reg.status === 409 || /already/i.test(reg.msg)
  if (!reg.ok && !already) return { ok: false, message: explain(reg.status, reg.msg) }
  // Already registered (or no email given): the role is granted through the users API instead.
  if (email && (already || !reg.ok)) return grantApiDeveloper(accessToken, merchantId, email)
  if (!email) {
    return {
      ok: true,
      message: `Project registered with ${merchantId}. Google also needs an API developer: enter the email of an admin on the account to finish.`,
    }
  }
  return { ok: true, message: `Merchant API sync enabled for ${merchantId}, with ${email} as the API developer.` }
}

/** The signed-in Google account's email from the token response's id_token (sign-in asks for `email`). */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
    return payload?.email_verified !== false && typeof payload?.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}

/** Register the current owner's connected account (store, or the flagship's own connection). */
export async function registerConnectedMerchant(developerEmail?: string | null): Promise<RegistrationResult> {
  try {
    const [token, merchantId] = await Promise.all([getAccessToken(), getMerchantId()])
    return await registerMerchantApi(token, merchantId, developerEmail)
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? 'Google Merchant is not connected.') }
  }
}

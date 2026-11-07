import crypto from 'crypto'
import { controlPlanePool } from '@/lib/tenant-registry'
import { ownMetaAppsById, platformMetaConfig } from '@/lib/catalog/meta'
import { META_ADS_PROVIDER } from '@/lib/meta-ads/client'
import { META_PAGE_PICK_PROVIDER } from '@/lib/social/meta-connect'

// Meta's deauthorize and data-deletion callbacks. Meta posts a signed_request naming the app-scoped
// user who removed the app; the Meta tokens stored for them are deleted.

export interface SignedRequest {
  user_id: string
  algorithm: string
  issued_at?: number
}

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** The signed_request field of Meta's form post (JSON accepted too). */
export async function signedRequestFrom(request: Request): Promise<string | null> {
  const type = request.headers.get('content-type') || ''
  try {
    if (type.includes('application/json')) {
      const v = (await request.json())?.signed_request
      return typeof v === 'string' && v ? v : null
    }
    const v = (await request.formData()).get('signed_request')
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

/** Verifies `<sig>.<payload>` (HMAC-SHA256 of the payload with the app secret). Null when invalid. */
export function parseSignedRequest(signed: string, appSecret: string): SignedRequest | null {
  const [sig, payload] = signed.split('.')
  if (!sig || !payload || !appSecret) return null
  const expected = crypto.createHmac('sha256', appSecret).update(payload).digest()
  const got = fromB64url(sig)
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null
  try {
    const data = JSON.parse(fromB64url(payload).toString('utf8'))
    if (String(data?.algorithm ?? '').toUpperCase() !== 'HMAC-SHA256' || !data?.user_id) return null
    return { ...data, user_id: String(data.user_id) }
  } catch {
    return null
  }
}

export interface MetaRequester {
  userId: string
  source: 'platform' | 'own'
  /** Stores whose own app signed it; null for the platform app (any store). */
  tenantIds: string[] | null
}

/**
 * The app that signed the request: the platform app, else stores' own apps (those with `appId` when the
 * callback URL names one). A store's own app can only clear its own stores' tokens.
 */
export async function verifyMetaSignedRequest(signed: string, appId?: string | null): Promise<MetaRequester | null> {
  const platform = platformMetaConfig()
  if (platform && (!appId || appId === platform.appId)) {
    const d = parseSignedRequest(signed, platform.appSecret)
    if (d) return { userId: d.user_id, source: 'platform', tenantIds: null }
  }
  let userId: string | null = null
  const tenantIds: string[] = []
  for (const app of await ownMetaAppsById(appId)) {
    const d = parseSignedRequest(signed, app.appSecret)
    if (!d) continue
    userId ??= d.user_id
    if (d.user_id === userId) tenantIds.push(app.tenantId)
  }
  return userId ? { userId, source: 'own', tenantIds } : null
}

/** Deletes every stored Meta token for this Facebook user. Returns how many connections were removed. */
export async function deleteMetaUserData(userId: string, tenantIds: string[] | null): Promise<number> {
  const pool = controlPlanePool()
  const scope = tenantIds ? ' AND tenant_id = ANY($2::uuid[])' : ''
  const args: unknown[] = tenantIds ? [userId, tenantIds] : [userId]
  const social = await pool.query(
    `DELETE FROM tenant_social_accounts WHERE fb_user_id = $1 AND provider IN ('facebook','instagram')${scope}`,
    args
  )
  const creds = await pool.query(
    `DELETE FROM tenant_integration_credentials WHERE provider IN ('${META_ADS_PROVIDER}','${META_PAGE_PICK_PROVIDER}')
       AND meta->>'fb_user_id' = $1${scope}`,
    args
  )
  return (social.rowCount ?? 0) + (creds.rowCount ?? 0)
}

function codeKey(): string {
  const k = process.env.CRON_SECRET
  if (!k) throw new Error('CRON_SECRET not set — required to sign data-deletion confirmation codes')
  return k
}

const codeSig = (payload: string) =>
  crypto.createHmac('sha256', codeKey()).update(`meta-deletion:${payload}`).digest('base64url').slice(0, 16)

/** A self-verifying confirmation code (no table): when the request came in and how much was deleted. */
export function deletionCode(deleted: number, at = new Date()): string {
  const payload = Buffer.from(JSON.stringify({ n: deleted, t: Math.floor(at.getTime() / 1000) })).toString('base64url')
  return `${payload}.${codeSig(payload)}`
}

export function readDeletionCode(code: string): { deleted: number; at: Date } | null {
  const [payload, sig] = code.split('.')
  if (!payload || !sig) return null
  const a = Buffer.from(sig)
  const b = Buffer.from(codeSig(payload))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const j = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return { deleted: Number(j.n) || 0, at: new Date(Number(j.t) * 1000) }
  } catch {
    return null
  }
}

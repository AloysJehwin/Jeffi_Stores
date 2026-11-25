import { randomUUID } from 'crypto'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { showcaseUrl } from './host'

// A Showcase's no-login preview link, /preview?t=<token> on the site's own host (showcase-service). The token is HS256
// over JWT_SECRET naming the site; its jti keys a showcase_preview_tokens row that can be revoked or cut short. It is
// good while the row is unrevoked and now < expires_at: 24h while the site is a draft, 30 minutes from the first
// publish. Never log a token.

const TYPE = 'showcase_preview'
export const PREVIEW_DRAFT_TTL_MS = 24 * 60 * 60 * 1000
export const PREVIEW_AFTER_PUBLISH_MS = 30 * 60 * 1000
const MAX_TOKEN = 2048
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || '')

export interface ShowcasePreviewClaims {
  siteId: string
  jti: string
  expiresAt: string
}

export type ShowcasePreviewCheck =
  | ({ state: 'valid' } & ShowcasePreviewClaims)
  | { state: 'expired' | 'revoked'; siteId: string; jti: string }
  | { state: 'invalid' }

/** The signed token. Its JWT exp is the latest its row could allow: expiresAt plus the after-publish window. */
export async function signShowcasePreviewToken(input: { siteId: string; expiresAt: Date; jti?: string }): Promise<{ token: string; jti: string }> {
  const jti = input.jti ?? randomUUID()
  const exp = Math.ceil((input.expiresAt.getTime() + PREVIEW_AFTER_PUBLISH_MS) / 1000)
  const token = await new SignJWT({ type: TYPE, siteId: input.siteId })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret())
  return { token, jti }
}

/**
 * What a token is now. `expired` and `revoked` still name the site (the signature held), so the page can send the
 * visitor to the live site; anything else unsigned, malformed or unknown is `invalid`.
 */
export async function checkShowcasePreviewToken(token: string | null | undefined): Promise<ShowcasePreviewCheck> {
  if (!token || token.length > MAX_TOKEN || !process.env.JWT_SECRET) return { state: 'invalid' }
  let payload: JWTPayload
  let jwtExpired = false
  try {
    payload = (await jwtVerify(token, secret(), { algorithms: ['HS256'] })).payload
  } catch (e) {
    // jose checks the signature before the claims, so an expired token's payload is genuine.
    const err = e as { code?: string; payload?: JWTPayload }
    if (err?.code !== 'ERR_JWT_EXPIRED' || !err.payload) return { state: 'invalid' }
    payload = err.payload
    jwtExpired = true
  }
  const { siteId, jti } = payload as { siteId?: unknown; jti?: unknown }
  if (payload.type !== TYPE || typeof siteId !== 'string' || typeof jti !== 'string' || !UUID_RE.test(siteId) || !UUID_RE.test(jti)) return { state: 'invalid' }
  const r = await controlPlanePool().query(`SELECT site_id, expires_at, revoked_at FROM showcase_preview_tokens WHERE jti = $1`, [jti])
  const row = r.rows[0]
  if (!row || String(row.site_id).toLowerCase() !== siteId.toLowerCase()) return { state: 'invalid' }
  const base = { siteId: String(row.site_id), jti }
  if (row.revoked_at) return { state: 'revoked', ...base }
  const until = Math.min(new Date(row.expires_at).getTime(), typeof payload.exp === 'number' ? payload.exp * 1000 : Infinity)
  if (jwtExpired || !(Date.now() < until)) return { state: 'expired', ...base }
  return { state: 'valid', ...base, expiresAt: new Date(until).toISOString() }
}

/** The claims of a good token: valid signature and type, an unrevoked row, now < expires_at. Else null. */
export async function verifyShowcasePreviewToken(token: string | null | undefined): Promise<ShowcasePreviewClaims | null> {
  const c = await checkShowcasePreviewToken(token)
  return c.state === 'valid' ? { siteId: c.siteId, jti: c.jti, expiresAt: c.expiresAt } : null
}

export const showcasePreviewLink = (slug: string, token: string) => `${showcaseUrl(slug)}/preview?t=${encodeURIComponent(token)}`

/** A new preview link for a site, good for PREVIEW_DRAFT_TTL_MS; null when the site does not exist. */
export async function mintPreview(siteId: string): Promise<{ token: string; jti: string; expiresAt: string; url: string } | null> {
  if (!UUID_RE.test(siteId)) return null
  const expiresAt = new Date(Date.now() + PREVIEW_DRAFT_TTL_MS)
  const jti = randomUUID()
  const r = await controlPlanePool().query(
    `INSERT INTO showcase_preview_tokens (jti, site_id, expires_at)
     SELECT $1, s.id, $3 FROM showcase_sites s WHERE s.id = $2
     RETURNING (SELECT slug FROM showcase_sites WHERE id = showcase_preview_tokens.site_id) AS slug`,
    [jti, siteId, expiresAt]
  )
  const slug = r.rows[0]?.slug
  if (!slug) return null
  const { token } = await signShowcasePreviewToken({ siteId, expiresAt, jti })
  return { token, jti, expiresAt: expiresAt.toISOString(), url: showcasePreviewLink(slug, token) }
}

/** At publish: every live link of the site now ends PREVIEW_AFTER_PUBLISH_MS after it. Returns how many changed. */
export async function shortenPreviewAfterPublish(siteId: string, publishedAt: Date = new Date()): Promise<number> {
  if (!UUID_RE.test(siteId)) return 0
  const r = await controlPlanePool().query(
    `UPDATE showcase_preview_tokens SET expires_at = $2 WHERE site_id = $1 AND revoked_at IS NULL AND expires_at > $3`,
    [siteId, new Date(publishedAt.getTime() + PREVIEW_AFTER_PUBLISH_MS), new Date()]
  )
  return r.rowCount ?? 0
}

/** Ends one link, or with `site` every link of that site, at once. Returns how many were revoked. */
export async function revokeShowcasePreview(target: { jti: string } | { siteId: string }): Promise<number> {
  const [col, id] = 'jti' in target ? ['jti', target.jti] : ['site_id', target.siteId]
  if (!UUID_RE.test(id)) return 0
  const r = await controlPlanePool().query(`UPDATE showcase_preview_tokens SET revoked_at = now() WHERE ${col} = $1 AND revoked_at IS NULL`, [id])
  return r.rowCount ?? 0
}

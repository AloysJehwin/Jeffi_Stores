import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { controlPlanePool, ROOT_DOMAIN } from '@/lib/tenant-registry/shared'
import { findOrCreateOwner, type Owner } from '@/lib/tenant-registry'
import { outreachSystemEmail } from '@/lib/auth/system-owners'
import { ensureShowcaseWorkspace } from '@/lib/showcase/workspace'
import type { ShowcaseBusiness } from '@/lib/showcase/types'

// Claiming an outreach Showcase. Until claimed, a site the outreach program builds is held by the system owner; the
// business owner opens /claim/<token> on ecom, signs in, and the site becomes theirs (owner_id, and a workspace of
// theirs). Only the token's SHA-256 is kept (outreach_contacts.claim_token_hash). The token carries its own expiry
// ("<exp base36>.<32 random bytes, base64url>"), which the hash covers, so no other column. Single use: once claimed,
// only the owner who claimed it may open it again, and that is a no-op. Never log a token.

export const CLAIM_TTL_MS = 14 * 24 * 60 * 60 * 1000
const TOKEN_RE = /^([0-9a-z]{1,11})\.([A-Za-z0-9_-]{43})$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

/** The token's hash and expiry, or null when it is not one of ours. */
function parse(token: unknown): { hash: string; expiresAt: number } | null {
  if (typeof token !== 'string') return null
  const m = TOKEN_RE.exec(token)
  return m ? { hash: sha256(token), expiresAt: parseInt(m[1], 36) * 1000 } : null
}

/** Constant-time: the stored hash against the token's. */
function hashMatches(stored: unknown, hash: string): boolean {
  if (typeof stored !== 'string' || stored.length !== hash.length) return false
  return timingSafeEqual(Buffer.from(stored), Buffer.from(hash))
}

export const claimUrl = (token: string) => `${(process.env.NEXT_PUBLIC_ECOM_URL || `https://ecom.${ROOT_DOMAIN}`).replace(/\/$/, '')}/claim/${token}`

/** The owner outreach sites belong to until claimed; made once, by its fixed internal address. */
export async function ensureOutreachSystemOwner(): Promise<Owner> {
  const email = outreachSystemEmail().toLowerCase()
  try {
    return await findOrCreateOwner(email, 'Outreach')
  } catch (e) {
    // Two at once: the other made it.
    if ((e as { code?: string })?.code === '23505') return findOrCreateOwner(email, 'Outreach')
    throw e
  }
}

/** A new claim link for the contact's site (replacing any earlier one); null when it has no site or is claimed. */
export async function createClaimToken(contactId: string): Promise<{ token: string; expiresAt: string; url: string } | null> {
  if (!UUID_RE.test(contactId)) return null
  const exp = Math.ceil((Date.now() + CLAIM_TTL_MS) / 1000)
  const token = `${exp.toString(36)}.${randomBytes(32).toString('base64url')}`
  const expiresAt = new Date(exp * 1000).toISOString()
  const r = await controlPlanePool().query(
    `WITH c AS (
       UPDATE outreach_contacts SET claim_token_hash = $2, updated_at = now()
        WHERE id = $1 AND status <> 'claimed' AND showcase_site_id IS NOT NULL RETURNING id)
     INSERT INTO outreach_events (contact_id, kind, data, actor) SELECT id, 'claim_link_created', $3::jsonb, 'system' FROM c RETURNING contact_id`,
    [contactId, sha256(token), JSON.stringify({ expires_at: expiresAt })]
  )
  return r.rowCount ? { token, expiresAt, url: claimUrl(token) } : null
}

export type ClaimPeek = { state: 'valid'; siteName: string } | { state: 'claimed'; siteName: string; claimedOwnerId: string | null } | { state: 'expired' | 'invalid' }

/** What a claim link is, without using it: the page shows the site's name before sign-in. */
export async function peekClaim(token: unknown): Promise<ClaimPeek> {
  const t = parse(token)
  if (!t) return { state: 'invalid' }
  const r = await controlPlanePool().query(
    `SELECT c.claim_token_hash, c.status, c.claimed_owner_id, c.business_name, s.slug, s.business->>'name' AS site_name
       FROM outreach_contacts c JOIN showcase_sites s ON s.id = c.showcase_site_id
      WHERE c.claim_token_hash = $1`,
    [t.hash]
  )
  const row = r.rows[0]
  if (!row || !hashMatches(row.claim_token_hash, t.hash)) return { state: 'invalid' }
  const siteName = String(row.site_name || row.business_name || row.slug || '').trim()
  if (row.status === 'claimed') return { state: 'claimed', siteName, claimedOwnerId: row.claimed_owner_id ?? null }
  if (Date.now() >= t.expiresAt) return { state: 'expired' }
  return { state: 'valid', siteName }
}

export type ClaimCode = 'invalid' | 'expired' | 'used' | 'no_site'
export type RedeemResult = { ok: true; siteId: string; tenantId: string | null; already: boolean } | { ok: false; code: ClaimCode; error: string }

export const CLAIM_ERRORS: Record<ClaimCode, string> = {
  invalid: 'This claim link is not valid. Check that you opened the whole link.',
  expired: 'This claim link has expired. Ask us for a new one.',
  used: 'This claim link has already been used.',
  no_site: 'The site for this link could not be found.',
}

const fail = (code: ClaimCode): RedeemResult => ({ ok: false, code, error: CLAIM_ERRORS[code] })

interface SiteRow {
  id: string
  owner_id: string
  tenant_id: string | null
  slug: string
  business: ShowcaseBusiness | null
}

/**
 * Gives the link's site to the owner, in one transaction: the site's owner_id (from the system owner), its workspace
 * (it leaves one that isn't the owner's, ending its billing line there), the contact `claimed` with claimed_owner_id,
 * and an outreach_events row. Then ensureShowcaseWorkspace gives it the owner's workspace; that makes tenants on its own
 * connections, so it runs after the commit, and a repeat redeem by the same owner retries it.
 */
export async function redeemClaim(token: unknown, ownerId: string): Promise<RedeemResult> {
  const t = parse(token)
  if (!t || !UUID_RE.test(ownerId)) return fail('invalid')
  const client = await controlPlanePool().connect()
  let site: SiteRow
  let already = false
  try {
    await client.query('BEGIN')
    const stop = async (code: ClaimCode) => {
      await client.query('ROLLBACK')
      return fail(code)
    }
    const c = (
      await client.query(`SELECT id, status, claim_token_hash, claimed_owner_id, showcase_site_id FROM outreach_contacts WHERE claim_token_hash = $1 FOR UPDATE`, [t.hash])
    ).rows[0]
    if (!c || !hashMatches(c.claim_token_hash, t.hash)) return await stop('invalid')
    if (c.status === 'claimed') {
      if (!same(c.claimed_owner_id, ownerId)) return await stop('used')
      already = true
    } else if (Date.now() >= t.expiresAt) return await stop('expired')
    const s: SiteRow | undefined = c.showcase_site_id
      ? (await client.query(`SELECT id, owner_id, tenant_id, slug, business FROM showcase_sites WHERE id = $1 FOR UPDATE`, [c.showcase_site_id])).rows[0]
      : undefined
    if (!s) return await stop('no_site')

    if (already) {
      if (!same(s.owner_id, ownerId)) return await stop('used')
      site = s
    } else {
      const system = (await client.query(`SELECT id FROM owners WHERE lower(email) = $1`, [outreachSystemEmail().toLowerCase()])).rows[0]?.id
      // Only a site the outreach owner still holds moves to someone.
      if (!same(s.owner_id, ownerId) && !same(s.owner_id, system)) return await stop('used')
      const keep = !!s.tenant_id && !!(await client.query(`SELECT 1 FROM owner_tenants WHERE owner_id = $1 AND tenant_id = $2`, [ownerId, s.tenant_id])).rowCount
      const tenantId = keep ? s.tenant_id : null
      await client.query(`UPDATE showcase_sites SET owner_id = $2, tenant_id = $3, updated_at = now() WHERE id = $1`, [s.id, ownerId, tenantId])
      if (s.tenant_id && !keep)
        await client.query(
          `UPDATE billing_lines SET status = 'ended', ends_at = COALESCE(ends_at, now()), updated_at = now()
            WHERE tenant_id = $1 AND kind = 'showcase_site' AND ref = $2 AND status <> 'ended'`,
          [s.tenant_id, s.id]
        )
      await client.query(`UPDATE outreach_contacts SET status = 'claimed', claimed_owner_id = $2, updated_at = now() WHERE id = $1`, [c.id, ownerId])
      await client.query(`INSERT INTO outreach_events (contact_id, kind, data, actor) VALUES ($1, 'claimed', $2::jsonb, $3)`, [
        c.id,
        JSON.stringify({ site_id: s.id, owner_id: ownerId, from_status: c.status, left_workspace: s.tenant_id && !keep ? s.tenant_id : null }),
        `owner:${ownerId}`,
      ])
      site = { ...s, owner_id: ownerId, tenant_id: tenantId }
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }

  const tenantId = await ensureShowcaseWorkspace({
    id: site.id,
    ownerId,
    slug: site.slug,
    tenantId: site.tenant_id,
    business: { name: '', ...(site.business ?? {}) },
  }).catch(e => {
    console.error(`[outreach-claim] no workspace for site ${site.id}:`, (e as Error)?.message || e)
    return null
  })
  // Its trial line on the new workspace now, rather than at the next daily sweep.
  if (tenantId && tenantId !== site.tenant_id) await import('@controller/lib/billing/sweep').then(m => m.syncShowcaseLines()).catch(() => {})
  return { ok: true, siteId: site.id, tenantId, already }
}

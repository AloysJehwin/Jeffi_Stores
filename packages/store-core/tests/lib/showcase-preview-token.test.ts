// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SignJWT } from 'jose'

// The Showcase no-login preview token: signed, typed, backed by a showcase_preview_tokens row that can be revoked
// or cut to 30 minutes at publish.

type Row = { site_id: string; expires_at: Date; revoked_at: Date | null }
const { db, query } = vi.hoisted(() => {
  const db = { tokens: new Map<string, Row>(), sites: new Map<string, string>() }
  const query = vi.fn(async (sql: string, p: any[]) => {
    const q = sql.replace(/\s+/g, ' ').trim()
    if (q.startsWith('INSERT INTO showcase_preview_tokens')) {
      const slug = db.sites.get(p[1])
      if (!slug) return { rows: [], rowCount: 0 }
      db.tokens.set(p[0], { site_id: p[1], expires_at: p[2], revoked_at: null })
      return { rows: [{ slug }], rowCount: 1 }
    }
    if (q.startsWith('SELECT site_id, expires_at, revoked_at FROM showcase_preview_tokens WHERE jti = $1')) {
      const r = db.tokens.get(p[0])
      return { rows: r ? [{ ...r }] : [] }
    }
    if (q.startsWith('UPDATE showcase_preview_tokens SET expires_at = $2')) {
      let n = 0
      for (const r of db.tokens.values())
        if (r.site_id === p[0] && !r.revoked_at && r.expires_at > p[2]) {
          r.expires_at = p[1]
          n++
        }
      return { rowCount: n }
    }
    const revoke = /^UPDATE showcase_preview_tokens SET revoked_at = now\(\) WHERE (jti|site_id) = \$1 AND revoked_at IS NULL$/.exec(q)
    if (revoke) {
      let n = 0
      for (const [jti, r] of db.tokens)
        if ((revoke[1] === 'jti' ? jti : r.site_id) === p[0] && !r.revoked_at) {
          r.revoked_at = new Date()
          n++
        }
      return { rowCount: n }
    }
    throw new Error(`unexpected SQL: ${q}`)
  })
  return { db, query }
})
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query }) }))

import {
  checkShowcasePreviewToken,
  mintPreview,
  PREVIEW_AFTER_PUBLISH_MS,
  PREVIEW_DRAFT_TTL_MS,
  revokeShowcasePreview,
  shortenPreviewAfterPublish,
  signShowcasePreviewToken,
  verifyShowcasePreviewToken,
} from '@/lib/showcase/preview-token'

const SITE = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const T0 = new Date('2026-11-24T10:00:00Z').getTime()
const at = (ms: number) => vi.setSystemTime(T0 + ms)
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET!)

describe('Showcase preview token', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    db.tokens.clear()
    db.sites.clear()
    db.sites.set(SITE, 'latte')
    db.sites.set(OTHER, 'brew')
  })
  afterEach(() => vi.useRealTimers())

  it('mints a link on the site host, good for 24h while a draft', async () => {
    const m = (await mintPreview(SITE))!
    expect(m.expiresAt).toBe(new Date(T0 + PREVIEW_DRAFT_TTL_MS).toISOString())
    expect(m.url).toBe(`http://site-latte.localhost:3000/preview?t=${encodeURIComponent(m.token)}`)
    expect(await verifyShowcasePreviewToken(m.token)).toEqual({ siteId: SITE, jti: m.jti, expiresAt: m.expiresAt })
    // Only the jti is stored, never the token.
    expect(JSON.stringify(query.mock.calls)).not.toContain(m.token)
  })

  it('mints nothing for a site that does not exist', async () => {
    expect(await mintPreview('33333333-3333-4333-8333-333333333333')).toBeNull()
    expect(await mintPreview('not-a-uuid')).toBeNull()
  })

  it('needs its row: a signed token with none is invalid', async () => {
    const { token } = await signShowcasePreviewToken({ siteId: SITE, expiresAt: new Date(T0 + 60_000) })
    expect(await checkShowcasePreviewToken(token)).toEqual({ state: 'invalid' })
  })

  it('refuses a bad signature, another token type, another site, and junk', async () => {
    const m = (await mintPreview(SITE))!
    const [h, p, s] = m.token.split('.')
    expect(await verifyShowcasePreviewToken(`${h}.${p}.${s.slice(0, -2)}xx`)).toBeNull()
    const homepage = await new SignJWT({ type: 'homepage_preview', siteId: SITE }).setProtectedHeader({ alg: 'HS256' }).setJti(m.jti).setExpirationTime('1h').sign(secret())
    expect(await checkShowcasePreviewToken(homepage)).toEqual({ state: 'invalid' })
    const forged = await new SignJWT({ type: 'showcase_preview', siteId: OTHER }).setProtectedHeader({ alg: 'HS256' }).setJti(m.jti).setExpirationTime('1h').sign(secret())
    expect(await checkShowcasePreviewToken(forged)).toEqual({ state: 'invalid' })
    const wrongKey = await new SignJWT({ type: 'showcase_preview', siteId: SITE }).setProtectedHeader({ alg: 'HS256' }).setJti(m.jti).setExpirationTime('1h').sign(new TextEncoder().encode('another-secret-another-secret-1234'))
    expect(await checkShowcasePreviewToken(wrongKey)).toEqual({ state: 'invalid' })
    for (const junk of [undefined, null, '', 'abc', 'x'.repeat(3000)]) expect(await checkShowcasePreviewToken(junk)).toEqual({ state: 'invalid' })
  })

  it('expires at expires_at, and still names its site after the JWT itself has run out', async () => {
    const m = (await mintPreview(SITE))!
    at(PREVIEW_DRAFT_TTL_MS - 1000)
    expect((await checkShowcasePreviewToken(m.token)).state).toBe('valid')
    at(PREVIEW_DRAFT_TTL_MS)
    expect(await checkShowcasePreviewToken(m.token)).toEqual({ state: 'expired', siteId: SITE, jti: m.jti })
    expect(await verifyShowcasePreviewToken(m.token)).toBeNull()
    at(PREVIEW_DRAFT_TTL_MS + PREVIEW_AFTER_PUBLISH_MS + 60_000)
    expect(await checkShowcasePreviewToken(m.token)).toEqual({ state: 'expired', siteId: SITE, jti: m.jti })
  })

  it('revokes one link, or every link of a site', async () => {
    const a = (await mintPreview(SITE))!
    const b = (await mintPreview(SITE))!
    const c = (await mintPreview(OTHER))!
    expect(await revokeShowcasePreview({ jti: a.jti })).toBe(1)
    expect(await checkShowcasePreviewToken(a.token)).toEqual({ state: 'revoked', siteId: SITE, jti: a.jti })
    expect((await checkShowcasePreviewToken(b.token)).state).toBe('valid')
    expect(await revokeShowcasePreview({ siteId: SITE })).toBe(1)
    expect((await checkShowcasePreviewToken(b.token)).state).toBe('revoked')
    expect((await checkShowcasePreviewToken(c.token)).state).toBe('valid')
    expect(await revokeShowcasePreview({ siteId: 'nope' })).toBe(0)
  })

  it('cuts every live link of the site to 30 minutes from publish', async () => {
    const live = (await mintPreview(SITE))!
    const other = (await mintPreview(OTHER))!
    at(-PREVIEW_DRAFT_TTL_MS)
    const old = (await mintPreview(SITE))!
    const revoked = (await mintPreview(SITE))!
    at(2 * 60 * 60 * 1000)
    await revokeShowcasePreview({ jti: revoked.jti })
    const published = new Date()
    expect(await shortenPreviewAfterPublish(SITE, published)).toBe(1)
    const until = new Date(published.getTime() + PREVIEW_AFTER_PUBLISH_MS).toISOString()
    expect(await verifyShowcasePreviewToken(live.token)).toEqual({ siteId: SITE, jti: live.jti, expiresAt: until })
    expect((await checkShowcasePreviewToken(old.token)).state).toBe('expired')
    expect((await checkShowcasePreviewToken(revoked.token)).state).toBe('revoked')
    expect((await verifyShowcasePreviewToken(other.token))?.expiresAt).toBe(new Date(T0 + PREVIEW_DRAFT_TTL_MS).toISOString())
    at(2 * 60 * 60 * 1000 + PREVIEW_AFTER_PUBLISH_MS)
    expect(await checkShowcasePreviewToken(live.token)).toEqual({ state: 'expired', siteId: SITE, jti: live.jti })
  })

  it('keeps the countdown honest: never later than the JWT allows', async () => {
    const m = (await mintPreview(SITE))!
    at(PREVIEW_DRAFT_TTL_MS - 60_000)
    await shortenPreviewAfterPublish(SITE)
    at(PREVIEW_DRAFT_TTL_MS + 5 * 60_000)
    await shortenPreviewAfterPublish(SITE)
    const jwtEnd = new Date(Math.ceil((T0 + PREVIEW_DRAFT_TTL_MS + PREVIEW_AFTER_PUBLISH_MS) / 1000) * 1000).toISOString()
    expect((await verifyShowcasePreviewToken(m.token))?.expiresAt).toBe(jwtEnd)
  })
})

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'

// Claiming an outreach Showcase: only the token's hash is kept; one owner claims it, once; the site moves from the
// outreach system owner (and out of a workspace that isn't theirs) to them, all in one transaction.

const SYSTEM = '99999999-9999-4999-8999-999999999999'
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const HOLD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

type Contact = { id: string; status: string; claim_token_hash: string | null; claimed_owner_id: string | null; showcase_site_id: string | null; business_name: string }
type Site = { id: string; owner_id: string; tenant_id: string | null; slug: string; business: { name: string } }

const h = vi.hoisted(() => {
  const db = {
    contacts: new Map<string, Contact>(),
    sites: new Map<string, Site>(),
    owners: new Map<string, string>(),
    ownerTenants: [] as [string, string][],
    lines: [] as { tenant_id: string; ref: string; status: string }[],
    events: [] as { contact_id: string; kind: string; data: any; actor: string }[],
    log: [] as string[],
  }
  const run = async (sql: string, p: any[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim()
    db.log.push(q.split(' ').slice(0, 3).join(' '))
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q)) return { rows: [], rowCount: 0 }
    if (q.startsWith('WITH c AS ( UPDATE outreach_contacts SET claim_token_hash')) {
      const c = db.contacts.get(p[0])
      if (!c || c.status === 'claimed' || !c.showcase_site_id) return { rows: [], rowCount: 0 }
      c.claim_token_hash = p[1]
      db.events.push({ contact_id: c.id, kind: 'claim_link_created', data: JSON.parse(p[2]), actor: 'system' })
      return { rows: [{ contact_id: c.id }], rowCount: 1 }
    }
    if (q.startsWith('SELECT c.claim_token_hash, c.status')) {
      const c = [...db.contacts.values()].find(x => x.claim_token_hash === p[0])
      const s = c?.showcase_site_id ? db.sites.get(c.showcase_site_id) : undefined
      return { rows: c && s ? [{ ...c, slug: s.slug, site_name: s.business.name }] : [] }
    }
    if (q.startsWith('SELECT id, status, claim_token_hash, claimed_owner_id, showcase_site_id FROM outreach_contacts')) {
      const c = [...db.contacts.values()].find(x => x.claim_token_hash === p[0])
      return { rows: c ? [{ ...c }] : [] }
    }
    if (q.startsWith('SELECT id, owner_id, tenant_id, slug, business FROM showcase_sites')) {
      const s = db.sites.get(p[0])
      return { rows: s ? [{ ...s }] : [] }
    }
    if (q.startsWith('SELECT id FROM owners WHERE lower(email)')) {
      const id = db.owners.get(p[0])
      return { rows: id ? [{ id }] : [] }
    }
    if (q.startsWith('SELECT 1 FROM owner_tenants')) {
      const n = db.ownerTenants.filter(([o, t]) => o === p[0] && t === p[1]).length
      return { rows: n ? [{}] : [], rowCount: n }
    }
    if (q.startsWith('UPDATE showcase_sites SET owner_id')) {
      Object.assign(db.sites.get(p[0])!, { owner_id: p[1], tenant_id: p[2] })
      return { rowCount: 1 }
    }
    if (q.startsWith('UPDATE billing_lines SET status')) {
      for (const l of db.lines) if (l.tenant_id === p[0] && l.ref === p[1] && l.status !== 'ended') l.status = 'ended'
      return { rowCount: 1 }
    }
    if (q.startsWith("UPDATE outreach_contacts SET status = 'claimed'")) {
      Object.assign(db.contacts.get(p[0])!, { status: 'claimed', claimed_owner_id: p[1] })
      return { rowCount: 1 }
    }
    if (q.startsWith('INSERT INTO outreach_events')) {
      db.events.push({ contact_id: p[0], kind: 'claimed', data: JSON.parse(p[1]), actor: p[2] })
      return { rowCount: 1 }
    }
    throw new Error(`unexpected SQL: ${q}`)
  }
  const release = vi.fn()
  return {
    db,
    release,
    query: vi.fn(run),
    connect: vi.fn(async () => ({ query: vi.fn(run), release })),
    findOrCreateOwner: vi.fn(),
    ensureShowcaseWorkspace: vi.fn(),
    syncShowcaseLines: vi.fn(),
  }
})

vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query: h.query, connect: h.connect }), ROOT_DOMAIN: 'jeffistores.in' }))
vi.mock('@/lib/tenant-registry', () => ({ findOrCreateOwner: h.findOrCreateOwner }))
vi.mock('@/lib/showcase/workspace', () => ({ ensureShowcaseWorkspace: h.ensureShowcaseWorkspace }))
vi.mock('@controller/lib/billing/sweep', () => ({ syncShowcaseLines: h.syncShowcaseLines }))

import { CLAIM_TTL_MS, claimUrl, createClaimToken, ensureOutreachSystemOwner, peekClaim, redeemClaim } from '@controller/lib/outreach/claim'

const T0 = new Date('2026-11-24T10:00:00Z').getTime()
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function seed(o: { site?: Partial<Site>; contact?: Partial<Contact> } = {}) {
  const { db } = h
  db.contacts.clear()
  db.sites.clear()
  db.owners.clear()
  db.ownerTenants = [[SYSTEM, HOLD]]
  db.lines = [{ tenant_id: HOLD, ref: SITE, status: 'trial' }]
  db.events = []
  db.log = []
  db.owners.set('outreach-system@jeffistores.in', SYSTEM)
  db.sites.set(SITE, { id: SITE, owner_id: SYSTEM, tenant_id: HOLD, slug: 'latte', business: { name: 'Latte Cafe' }, ...o.site })
  db.contacts.set(CONTACT, { id: CONTACT, status: 'published', claim_token_hash: null, claimed_owner_id: null, showcase_site_id: SITE, business_name: 'Latte', ...o.contact })
}

describe('outreach claim', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: T0 })
    seed()
    h.ensureShowcaseWorkspace.mockResolvedValue('new-tenant')
    h.syncShowcaseLines.mockResolvedValue(1)
  })
  afterEach(() => vi.useRealTimers())

  it('keeps only the SHA-256 of a random, URL-safe token that expires in 14 days', async () => {
    const c = (await createClaimToken(CONTACT))!
    expect(c.token).toMatch(/^[0-9a-z]+\.[A-Za-z0-9_-]{43}$/)
    expect(c.expiresAt).toBe(new Date(T0 + CLAIM_TTL_MS).toISOString())
    expect(c.url).toBe(`https://ecom.jeffistores.in/claim/${c.token}`)
    expect(h.db.contacts.get(CONTACT)!.claim_token_hash).toBe(sha(c.token))
    expect(JSON.stringify(h.query.mock.calls)).not.toContain(c.token)
    expect(h.db.events).toEqual([{ contact_id: CONTACT, kind: 'claim_link_created', data: { expires_at: c.expiresAt }, actor: 'system' }])
    const again = (await createClaimToken(CONTACT))!
    expect(again.token).not.toBe(c.token)
    expect(await peekClaim(c.token)).toEqual({ state: 'invalid' })
  })

  it('makes no link for a claimed contact, one without a site, or a bad id', async () => {
    seed({ contact: { status: 'claimed' } })
    expect(await createClaimToken(CONTACT)).toBeNull()
    seed({ contact: { showcase_site_id: null } })
    expect(await createClaimToken(CONTACT)).toBeNull()
    expect(await createClaimToken('nope')).toBeNull()
  })

  it('peeks without using the link', async () => {
    const { token } = (await createClaimToken(CONTACT))!
    expect(await peekClaim(token)).toEqual({ state: 'valid', siteName: 'Latte Cafe' })
    expect(await peekClaim(`${token.slice(0, -1)}A`)).toEqual({ state: 'invalid' })
    expect(await peekClaim('junk')).toEqual({ state: 'invalid' })
    vi.setSystemTime(T0 + CLAIM_TTL_MS)
    expect(await peekClaim(token)).toEqual({ state: 'expired' })
    expect(h.db.contacts.get(CONTACT)!.status).toBe('published')
  })

  it('gives the site to the owner: owner, workspace, contact, event, in one transaction', async () => {
    const { token } = (await createClaimToken(CONTACT))!
    h.db.events = []
    h.db.log = []
    const r = await redeemClaim(token, OWNER)
    expect(r).toEqual({ ok: true, siteId: SITE, tenantId: 'new-tenant', already: false })
    expect(h.db.sites.get(SITE)).toMatchObject({ owner_id: OWNER, tenant_id: null })
    expect(h.db.lines[0].status).toBe('ended')
    expect(h.db.contacts.get(CONTACT)).toMatchObject({ status: 'claimed', claimed_owner_id: OWNER })
    expect(h.db.events).toEqual([
      { contact_id: CONTACT, kind: 'claimed', data: { site_id: SITE, owner_id: OWNER, from_status: 'published', left_workspace: HOLD }, actor: `owner:${OWNER}` },
    ])
    expect(h.db.log[0]).toBe('BEGIN')
    expect(h.db.log.at(-1)).toBe('COMMIT')
    expect(h.release).toHaveBeenCalledOnce()
    expect(h.ensureShowcaseWorkspace).toHaveBeenCalledWith({ id: SITE, ownerId: OWNER, slug: 'latte', tenantId: null, business: { name: 'Latte Cafe' } })
    expect(h.syncShowcaseLines).toHaveBeenCalledOnce()
  })

  it("keeps the site in a workspace that is already the owner's", async () => {
    const { token } = (await createClaimToken(CONTACT))!
    h.db.ownerTenants.push([OWNER, HOLD])
    h.ensureShowcaseWorkspace.mockResolvedValue(HOLD)
    expect(await redeemClaim(token, OWNER)).toMatchObject({ ok: true, tenantId: HOLD })
    expect(h.db.sites.get(SITE)!.tenant_id).toBe(HOLD)
    expect(h.db.lines[0].status).toBe('trial')
    expect(h.syncShowcaseLines).not.toHaveBeenCalled()
  })

  it('is idempotent for the owner who claimed it, even after the link would have expired', async () => {
    const { token } = (await createClaimToken(CONTACT))!
    await redeemClaim(token, OWNER)
    const events = h.db.events.length
    vi.setSystemTime(T0 + CLAIM_TTL_MS + 1000)
    expect(await redeemClaim(token, OWNER)).toEqual({ ok: true, siteId: SITE, tenantId: 'new-tenant', already: true })
    expect(h.db.events).toHaveLength(events)
  })

  it('refuses a reuse by another owner', async () => {
    const { token } = (await createClaimToken(CONTACT))!
    await redeemClaim(token, OWNER)
    expect(await redeemClaim(token, OTHER)).toMatchObject({ ok: false, code: 'used' })
    expect(h.db.sites.get(SITE)!.owner_id).toBe(OWNER)
    expect(h.db.log.at(-1)).toBe('ROLLBACK')
  })

  it('refuses an expired link and changes nothing', async () => {
    const { token } = (await createClaimToken(CONTACT))!
    vi.setSystemTime(T0 + CLAIM_TTL_MS)
    expect(await redeemClaim(token, OWNER)).toEqual({ ok: false, code: 'expired', error: expect.stringMatching(/expired/) })
    expect(h.db.sites.get(SITE)!.owner_id).toBe(SYSTEM)
    expect(h.db.contacts.get(CONTACT)!.status).toBe('published')
    expect(h.ensureShowcaseWorkspace).not.toHaveBeenCalled()
  })

  it('refuses an invalid or tampered token, and a site that someone else already owns', async () => {
    const { token } = (await createClaimToken(CONTACT))!
    expect(await redeemClaim('junk', OWNER)).toMatchObject({ ok: false, code: 'invalid' })
    const [exp, rand] = token.split('.')
    expect(await redeemClaim(`${(parseInt(exp, 36) + 9999).toString(36)}.${rand}`, OWNER)).toMatchObject({ ok: false, code: 'invalid' })
    expect(await redeemClaim(token, 'not-a-uuid')).toMatchObject({ ok: false, code: 'invalid' })
    h.db.sites.get(SITE)!.owner_id = OTHER
    expect(await redeemClaim(token, OWNER)).toMatchObject({ ok: false, code: 'used' })
    expect(h.db.contacts.get(CONTACT)!.status).toBe('published')
  })

  it('rolls back and releases the connection when a write fails', async () => {
    const { token } = (await createClaimToken(CONTACT))!
    const client = { query: vi.fn(async (sql: string, p?: any[]) => (sql.includes('UPDATE showcase_sites') ? Promise.reject(new Error('boom')) : h.query(sql, p))), release: vi.fn() }
    h.connect.mockResolvedValueOnce(client)
    await expect(redeemClaim(token, OWNER)).rejects.toThrow('boom')
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('makes the outreach system owner once, by its internal address', async () => {
    const owner = { id: SYSTEM, email: 'outreach-system@jeffistores.in', name: 'Outreach', created_at: '' }
    h.findOrCreateOwner.mockResolvedValue(owner)
    expect(await ensureOutreachSystemOwner()).toBe(owner)
    expect(h.findOrCreateOwner).toHaveBeenCalledWith('outreach-system@jeffistores.in', 'Outreach')
    h.findOrCreateOwner.mockReset()
    h.findOrCreateOwner.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' })).mockResolvedValueOnce(owner)
    expect(await ensureOutreachSystemOwner()).toBe(owner)
    expect(h.findOrCreateOwner).toHaveBeenCalledTimes(2)
  })

  it('links to the claim page on ecom', () => {
    expect(claimUrl('abc.def')).toBe('https://ecom.jeffistores.in/claim/abc.def')
  })
})

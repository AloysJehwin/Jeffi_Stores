// @vitest-environment node
//
// DB-backed (jeffi_test): the outreach build on real tables. A draft held by the outreach owner wears a ready-made
// theme at once (no AI), with a working preview token; the brief fills the site's details and starts (here: claims)
// one background generation; publish refuses before a full design and, after one, puts the site live with its trial,
// cuts the preview link to 30 minutes and stores only the claim token's hash. The generation itself is AI and stays
// mocked (startRun); the unit tests cover it.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb } from '../../../packages/store-core/integration-tests/db/harness'
import { endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const startRun = vi.hoisted(() => vi.fn())
vi.mock('@controller/lib/outreach/build/run', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/build/run')>()), startRun }))

describe.skipIf(!API_DB_ENABLED)('outreach build pipeline (real DB)', () => {
  let cp: any
  let build: typeof import('@controller/lib/outreach/build')
  let previewToken: typeof import('@/lib/showcase/preview-token')
  const contactId = crypto.randomUUID()
  const tenantId = crypto.randomUUID()
  const suffix = crypto.randomBytes(3).toString('hex')
  const phone = `+9199${String(parseInt(suffix, 16)).padStart(8, '0').slice(0, 8)}`
  const name = `Apitest Bakery ${suffix}`
  let systemOwnerExisted = true
  let systemOwnerId = ''
  let siteId = ''

  beforeAll(async () => {
    const url = requireTestDb()
    const cpUrl = process.env.CONTROL_PLANE_DATABASE_URL
    if (cpUrl && new URL(cpUrl).pathname.replace(/^\//, '') !== 'jeffi_test') throw new Error('CONTROL_PLANE_DATABASE_URL must be jeffi_test for this test')
    process.env.CONTROL_PLANE_DATABASE_URL = url
    cp = (await import('@/lib/tenant-registry')).controlPlanePool()
    systemOwnerExisted = !!(await cp.query(`SELECT 1 FROM owners WHERE lower(email) = lower($1)`, [(await import('@/lib/auth/system-owners')).outreachSystemEmail()])).rowCount
    build = await import('@controller/lib/outreach/build')
    previewToken = await import('@/lib/showcase/preview-token')
    await cp.query(
      `INSERT INTO outreach_contacts (id, program, phone, business_name, category, city, language, source, status)
       VALUES ($1, 'showcase-offer', $2, $3, 'Bakery', 'Pune', 'hi', 'apitest', 'interested')`,
      [contactId, phone, name]
    )
    await cp.query(`INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1, $2, 'Apitest Outreach', 'active', '{showcase}'::text[])`, [tenantId, `apitest-outreach-${suffix}`])
  }, 60_000)

  afterAll(async () => {
    if (!cp) return
    if (siteId) {
      await cp.query(`DELETE FROM showcase_preview_tokens WHERE site_id = $1`, [siteId]).catch(() => {})
      await cp.query(`DELETE FROM site_studio_sessions WHERE site_id = $1`, [siteId]).catch(() => {})
    }
    await cp.query(`DELETE FROM outreach_contacts WHERE id = $1`, [contactId]).catch(() => {})
    await cp.query(`DELETE FROM billing_lines WHERE tenant_id = $1`, [tenantId]).catch(() => {})
    if (siteId) await cp.query(`DELETE FROM showcase_sites WHERE id = $1`, [siteId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => {})
    if (!systemOwnerExisted && systemOwnerId) await cp.query(`DELETE FROM owners WHERE id = $1`, [systemOwnerId]).catch(() => {})
    await endPool()
  })

  const contact = async () => (await cp.query(`SELECT * FROM outreach_contacts WHERE id = $1`, [contactId])).rows[0]
  const site = async () => (await cp.query(`SELECT * FROM showcase_sites WHERE id = $1`, [siteId])).rows[0]
  const kinds = async () => (await cp.query(`SELECT kind, data FROM outreach_events WHERE contact_id = $1 ORDER BY id`, [contactId])).rows

  it('starts a draft held by the outreach owner, wearing a sketch at once, with a working preview link', async () => {
    const r = await build.startDraft(contactId, { businessName: name, language: 'hi' })
    siteId = r.siteId
    const s = await site()
    systemOwnerId = s.owner_id
    const owner = (await cp.query(`SELECT email FROM owners WHERE id = $1`, [s.owner_id])).rows[0]
    expect(owner.email).toMatch(/^outreach-system@/)
    expect(s.status).toBe('draft')
    expect(s.business).toMatchObject({ name, profession: 'Bakery', city: 'Pune' })
    // The sketch: a real page and theme, no AI.
    expect(s.page.order.length).toBeGreaterThan(3)
    expect(s.theme).toBeTruthy()
    const session = (await cp.query(`SELECT direction, generated_at, free_used_at, spent_inr FROM site_studio_sessions WHERE site_id = $1`, [siteId])).rows[0]
    expect(session.direction.id).toMatch(/^theme:minimalist\./)
    expect([session.generated_at, session.free_used_at, Number(session.spent_inr)]).toEqual([null, null, 0])
    const token = new URL(r.previewUrl).searchParams.get('t')
    expect(await previewToken.verifyShowcasePreviewToken(token)).toMatchObject({ siteId })
    const c = await contact()
    expect(c).toMatchObject({ showcase_site_id: siteId, status: 'building' })
    const events = await kinds()
    const started = events.find((e: any) => e.kind === 'draft_started').data
    expect(started).toMatchObject({ site_id: siteId, previewUrl: r.previewUrl })
    // The sketch is there within seconds, without AI.
    expect(started.ms).toBeLessThan(15_000)

    const again = await build.startDraft(contactId, { businessName: name, language: 'hi' })
    expect(again.siteId).toBe(siteId)
    expect((await cp.query(`SELECT count(*)::int AS n FROM showcase_sites WHERE owner_id = $1 AND business->>'name' = $2`, [s.owner_id, name])).rows[0].n).toBe(1)
  }, 60_000)

  it('fills the site from the brief at once and starts one generation when enough is known', async () => {
    const first = await build.mergeBrief(contactId, { whatTheyDo: 'Eggless cakes and fresh breads, baked every morning.', hours: 'Tue-Sun 8am-9pm', contact: { phone: '9822012345' } })
    expect(first).toEqual({ building: false, missing: ['audience', 'highlights', 'address', 'style'] })
    expect((await site()).business).toMatchObject({ tagline: 'Eggless cakes and fresh breads, baked every morning', hours: 'Tue-Sun 8am-9pm', phone: '9822012345' })
    expect(startRun).not.toHaveBeenCalled()

    const second = await build.mergeBrief(contactId, { audience: 'Families and offices in Kothrud' })
    expect(second.building).toBe(true)
    const c = await contact()
    expect(c.extra.brief).toMatchObject({ audience: 'Families and offices in Kothrud', contact: { phone: '9822012345' } })
    expect(c.extra.build).toMatchObject({ state: 'running', builds: 1 })
    expect(startRun).toHaveBeenCalledWith(contactId, c.extra.build.runId)
    expect((await kinds()).map((e: any) => e.kind)).toContain('build_started')
    await expect(build.publish(contactId)).rejects.toMatchObject({ code: 'building' })
  }, 60_000)

  it('publishes after a full design: live, the trial started, the preview cut to 30 minutes, a claim link', async () => {
    // The generation's own result, as the runner leaves it.
    await cp.query(`UPDATE outreach_contacts SET extra = jsonb_set(extra, '{build}', $2::jsonb) WHERE id = $1`, [contactId, JSON.stringify({ state: 'done', builds: 1, builtAt: new Date().toISOString() })])
    await cp.query(`UPDATE showcase_sites SET tenant_id = $2 WHERE id = $1`, [siteId, tenantId])
    const r = await build.publish(contactId)
    const s = await site()
    expect(r.liveUrl).toContain(`site-${s.slug}`)
    expect(r.claimUrl).toMatch(/\/claim\/[0-9a-z]+\.[A-Za-z0-9_-]{43}$/)
    expect(s.status).toBe('live')
    expect(new Date(s.trial_ends_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000)
    const c = await contact()
    expect(c.status).toBe('published')
    expect(c.claim_token_hash).toBe(crypto.createHash('sha256').update(r.claimUrl.split('/claim/')[1]).digest('hex'))
    const tokens = (await cp.query(`SELECT expires_at FROM showcase_preview_tokens WHERE site_id = $1 AND revoked_at IS NULL`, [siteId])).rows
    for (const t of tokens) expect(new Date(t.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 31 * 60_000)
    const published = (await kinds()).find((e: any) => e.kind === 'published')
    expect(published.data).toMatchObject({ liveUrl: r.liveUrl, first: true })
    expect(JSON.stringify(published.data)).not.toContain(r.claimUrl.split('/claim/')[1])
  }, 60_000)
})

// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — admin campaigns route group (non-scenario routes).
// Real authenticateAdmin → resolveSession → hasScope chain + real campaigns/campaign_drafts/coupons/
// categories/email_campaigns_sent reads & writes. Scenarios endpoints live in campaigns-scenarios.test.ts.
// Routes that proxy to AI (generate) or send real email/messages (run, test) are skipped — see report.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin campaigns API — list/create/detail/draft/publish/recipients (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let list: any
  let detail: any
  let draft: any
  let publish: any
  let recipients: any
  let eligible: any
  let coupons: any
  let reorder: any
  let overview: any
  let fullSid = ''
  let narrowSid = ''

  const sfx = crypto.randomBytes(5).toString('hex')
  const kind = `test_campaign_${sfx}` // FK child of campaigns.kind
  const couponId = crypto.randomUUID()
  const couponCode = `CAMP${sfx.toUpperCase()}`
  const sentId = crypto.randomUUID()

  const ctx = (k: string) => ({ params: Promise.resolve({ kind: k }) })

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    list = await import('@admin/app/api/(admin)/admin/campaigns/route')
    detail = await import('@admin/app/api/(admin)/admin/campaigns/[kind]/route')
    draft = await import('@admin/app/api/(admin)/admin/campaigns/[kind]/draft/route')
    publish = await import('@admin/app/api/(admin)/admin/campaigns/[kind]/publish/route')
    recipients = await import('@admin/app/api/(admin)/admin/campaigns/[kind]/recipients/route')
    eligible = await import('@admin/app/api/(admin)/admin/campaigns/[kind]/eligible/route')
    coupons = await import('@admin/app/api/(admin)/admin/campaigns/coupons/route')
    reorder = await import('@admin/app/api/(admin)/admin/campaigns/reorder-intervals/route')
    overview = await import('@admin/app/api/(admin)/admin/campaigns/overview/route')

    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    // Narrow admin: a non-platform role whose scopes lack mailer:*/campaigns:* → 403 everywhere here.
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))

    // Seed one active coupon (coupons GET reads is_active=TRUE) and a standalone campaign (scenario_kind
    // NULL so no scenarios FK parent is needed) plus one email_campaigns_sent row for recipients/detail.
    await db.query(
      `INSERT INTO coupons (id, code, discount_type, discount_value, is_active) VALUES ($1,$2,'percentage',10,true)`,
      [couponId, couponCode]
    )
    await db.query(
      `INSERT INTO campaigns (kind, name, enabled, subject_template, body_template, scenario_kind)
       VALUES ($1,$2,false,'Hi {firstName}','<p>Hi {firstName}</p>',NULL)`,
      [kind, `Test Campaign ${sfx}`]
    )
    await db.query(
      `INSERT INTO email_campaigns_sent (id, campaign_kind, user_id, sent_at, opened_at)
       VALUES ($1,$2,$3,NOW(),NOW())`,
      [sentId, kind, FIXTURES.customerId]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM email_campaigns_sent WHERE campaign_kind=$1`, [kind]).catch(() => {})
    await db.query(`DELETE FROM campaign_drafts WHERE kind=$1`, [kind]).catch(() => {})
    await db.query(`DELETE FROM campaigns WHERE kind=$1`, [kind]).catch(() => {})
    await db.query(`DELETE FROM coupons WHERE id=$1`, [couponId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // --- GET /campaigns (mailer:read) ---
  it('GET list 401 without a session', async () => {
    const res = await list.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns') as any)
    expect(res.status).toBe(401)
  })

  it('GET list 403 for an admin lacking mailer:read', async () => {
    const res = await list.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('GET list 200 returns campaigns incl. the seeded one + total', async () => {
    const res = await list.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns?limit=50', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.campaigns)).toBe(true)
    expect(body).toHaveProperty('total')
    expect(body.campaigns.some((c: any) => c.kind === kind)).toBe(true)
  })

  // --- POST /campaigns (mailer:write) ---
  it('POST create 401 without a session', async () => {
    const res = await list.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns', { body: { name: 'x', kind: 'x' } }) as any)
    expect(res.status).toBe(401)
  })

  it('POST create 403 for an admin lacking mailer:write', async () => {
    const res = await list.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns', { sid: narrowSid, body: { name: 'x', kind: 'x' } }) as any)
    expect(res.status).toBe(403)
  })

  it('POST create 400 on missing name/kind', async () => {
    const res = await list.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns', { sid: fullSid, body: { name: '' } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST create 201-shape writes a campaign that is then readable from the table', async () => {
    const newKind = `test_created_${sfx}`
    const res = await list.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns', { sid: fullSid, body: { name: `Created ${sfx}`, kind: newKind } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.kind).toBe(newKind)
    const rows = await db.query(`SELECT kind, enabled FROM campaigns WHERE kind=$1`, [newKind])
    expect(rows.rows[0].enabled).toBe(false)
    await db.query(`DELETE FROM campaigns WHERE kind=$1`, [newKind]).catch(() => {})
  })

  it('POST create 409 on a duplicate kind', async () => {
    const res = await list.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns', { sid: fullSid, body: { name: 'dup', kind } }) as any)
    expect(res.status).toBe(409)
  })

  // --- GET /campaigns/[kind] (mailer:read) ---
  it('GET detail 401 without a session', async () => {
    const res = await detail.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}`) as any, ctx(kind))
    expect(res.status).toBe(401)
  })

  it('GET detail 403 for an admin lacking mailer:read', async () => {
    const res = await detail.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}`, { sid: narrowSid }) as any, ctx(kind))
    expect(res.status).toBe(403)
  })

  it('GET detail 404 for an unknown kind', async () => {
    const res = await detail.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/nope_${sfx}`, { sid: fullSid }) as any, ctx(`nope_${sfx}`))
    expect(res.status).toBe(404)
  })

  it('GET detail 200 returns campaign + recentSends (the seeded send is there)', async () => {
    const res = await detail.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}`, { sid: fullSid }) as any, ctx(kind))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.campaign.kind).toBe(kind)
    expect(Array.isArray(body.recentSends)).toBe(true)
    expect(body.total).toBeGreaterThanOrEqual(1)
  })

  // --- PATCH /campaigns/[kind] (mailer:write) ---
  it('PATCH detail 403 for an admin lacking mailer:write', async () => {
    const res = await detail.PATCH(await apiRequest('PATCH', `http://localhost/api/admin/campaigns/${kind}`, { sid: narrowSid, body: { enabled: true } }) as any, ctx(kind))
    expect(res.status).toBe(403)
  })

  it('PATCH detail 200 flips enabled and persists to the table', async () => {
    const res = await detail.PATCH(await apiRequest('PATCH', `http://localhost/api/admin/campaigns/${kind}`, { sid: fullSid, body: { enabled: true, delay_hours: 48 } }) as any, ctx(kind))
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT enabled, delay_hours FROM campaigns WHERE kind=$1`, [kind])
    expect(rows.rows[0].enabled).toBe(true)
    expect(rows.rows[0].delay_hours).toBe(48)
    // reset so later run/eligible-style assertions here see a consistent row
    await db.query(`UPDATE campaigns SET enabled=false WHERE kind=$1`, [kind]).catch(() => {})
  })

  // --- draft: GET/PATCH/DELETE (campaigns:read / campaigns:write) ---
  it('GET draft 401 without a session', async () => {
    const res = await draft.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/draft`) as any, ctx(kind))
    expect(res.status).toBe(401)
  })

  it('GET draft 403 for an admin lacking campaigns:read', async () => {
    const res = await draft.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/draft`, { sid: narrowSid }) as any, ctx(kind))
    expect(res.status).toBe(403)
  })

  it('PATCH draft 403 for an admin lacking campaigns:write', async () => {
    const res = await draft.PATCH(await apiRequest('PATCH', `http://localhost/api/admin/campaigns/${kind}/draft`, { sid: narrowSid, body: { delay_hours: 72 } }) as any, ctx(kind))
    expect(res.status).toBe(403)
  })

  it('PATCH draft 200 upserts draft_fields, GET reads them back', async () => {
    const pr = await draft.PATCH(await apiRequest('PATCH', `http://localhost/api/admin/campaigns/${kind}/draft`, { sid: fullSid, body: { delay_hours: 72 } }) as any, ctx(kind))
    expect(pr.status).toBe(200)
    const gr = await draft.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/draft`, { sid: fullSid }) as any, ctx(kind))
    expect(gr.status).toBe(200)
    const body = await gr.json()
    expect(body.draft_fields).toMatchObject({ delay_hours: 72 })
    const rows = await db.query(`SELECT fields FROM campaign_drafts WHERE kind=$1`, [kind])
    expect(rows.rows[0].fields.delay_hours).toBe(72)
  })

  it('DELETE draft 200 clears the draft', async () => {
    const res = await draft.DELETE(await apiRequest('DELETE', `http://localhost/api/admin/campaigns/${kind}/draft`, { sid: fullSid }) as any, ctx(kind))
    expect(res.status).toBe(200)
  })

  // --- publish (campaigns:write) ---
  it('POST publish 403 for an admin lacking campaigns:write', async () => {
    const res = await publish.POST(await apiRequest('POST', `http://localhost/api/admin/campaigns/${kind}/publish`, { sid: narrowSid }) as any, ctx(kind))
    expect(res.status).toBe(403)
  })

  it('POST publish 404 for an unknown campaign', async () => {
    const res = await publish.POST(await apiRequest('POST', `http://localhost/api/admin/campaigns/nope_${sfx}/publish`, { sid: fullSid }) as any, ctx(`nope_${sfx}`))
    expect(res.status).toBe(404)
  })

  it('POST publish 400 when there is no draft to publish', async () => {
    // draft row was cleared above (fields = {}), so publish rejects.
    const res = await publish.POST(await apiRequest('POST', `http://localhost/api/admin/campaigns/${kind}/publish`, { sid: fullSid }) as any, ctx(kind))
    expect(res.status).toBe(400)
  })

  it('POST publish 200 applies a safe draft to the live row then clears it', async () => {
    // A draft touching only delay_hours (no template) passes window/variable checks for a NULL scenario.
    await draft.PATCH(await apiRequest('PATCH', `http://localhost/api/admin/campaigns/${kind}/draft`, { sid: fullSid, body: { delay_hours: 96 } }) as any, ctx(kind))
    const res = await publish.POST(await apiRequest('POST', `http://localhost/api/admin/campaigns/${kind}/publish`, { sid: fullSid }) as any, ctx(kind))
    expect(res.status).toBe(200)
    const live = await db.query(`SELECT delay_hours FROM campaigns WHERE kind=$1`, [kind])
    expect(live.rows[0].delay_hours).toBe(96)
    const d = await db.query(`SELECT fields FROM campaign_drafts WHERE kind=$1`, [kind])
    expect(Object.keys(d.rows[0].fields).length).toBe(0)
  })

  // --- recipients (mailer:read) ---
  it('GET recipients 401 without a session', async () => {
    const res = await recipients.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/recipients?metric=sent`) as any, ctx(kind))
    expect(res.status).toBe(401)
  })

  it('GET recipients 403 for an admin lacking mailer:read', async () => {
    const res = await recipients.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/recipients?metric=sent`, { sid: narrowSid }) as any, ctx(kind))
    expect(res.status).toBe(403)
  })

  it('GET recipients 400 on an unknown metric', async () => {
    const res = await recipients.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/recipients?metric=bogus`, { sid: fullSid }) as any, ctx(kind))
    expect(res.status).toBe(400)
  })

  it('GET recipients 200 lists the seeded sent/opened recipient', async () => {
    const res = await recipients.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/recipients?metric=opened`, { sid: fullSid }) as any, ctx(kind))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBeGreaterThanOrEqual(1)
    expect(body.rows.some((r: any) => r.id === sentId)).toBe(true)
  })

  // --- eligible (mailer:read) — NULL scenario_kind → no module → empty w/ note (no scenario SQL run) ---
  it('GET eligible 403 for an admin lacking mailer:read', async () => {
    const res = await eligible.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/eligible`, { sid: narrowSid }) as any, ctx(kind))
    expect(res.status).toBe(403)
  })

  it('GET eligible 404 for an unknown campaign', async () => {
    const res = await eligible.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/nope_${sfx}/eligible`, { sid: fullSid }) as any, ctx(`nope_${sfx}`))
    expect(res.status).toBe(404)
  })

  it('GET eligible 200 with a note when no scenario module is registered', async () => {
    const res = await eligible.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/${kind}/eligible`, { sid: fullSid }) as any, ctx(kind))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(body.eligible).toEqual([])
    expect(typeof body.note).toBe('string')
  })

  // --- coupons (mailer:read) ---
  it('GET coupons 401 without a session', async () => {
    const res = await coupons.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/coupons') as any)
    expect(res.status).toBe(401)
  })

  it('GET coupons 403 for an admin lacking mailer:read', async () => {
    const res = await coupons.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/coupons', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('GET coupons 200 returns the seeded active coupon', async () => {
    const res = await coupons.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/coupons', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.coupons.some((c: any) => c.id === couponId)).toBe(true)
  })

  // --- reorder-intervals (campaigns:read / campaigns:write) ---
  it('GET reorder-intervals 401 without a session', async () => {
    const res = await reorder.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/reorder-intervals') as any)
    expect(res.status).toBe(401)
  })

  it('GET reorder-intervals 403 for an admin lacking campaigns:read', async () => {
    const res = await reorder.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/reorder-intervals', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('GET reorder-intervals 200 returns a categories array', async () => {
    const res = await reorder.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/reorder-intervals', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.categories)).toBe(true)
  })

  it('PUT reorder-intervals 403 for an admin lacking campaigns:write', async () => {
    const res = await reorder.PUT(await apiRequest('PUT', 'http://localhost/api/admin/campaigns/reorder-intervals', { sid: narrowSid, body: { intervals: [] } }) as any)
    expect(res.status).toBe(403)
  })

  it('PUT reorder-intervals 400 on an invalid payload', async () => {
    const res = await reorder.PUT(await apiRequest('PUT', 'http://localhost/api/admin/campaigns/reorder-intervals', { sid: fullSid, body: { intervals: [{ categoryId: 'not-a-uuid', days: 10 }] } }) as any)
    expect(res.status).toBe(400)
  })

  it('PUT reorder-intervals 200 on an empty-but-valid payload (0 updated)', async () => {
    const res = await reorder.PUT(await apiRequest('PUT', 'http://localhost/api/admin/campaigns/reorder-intervals', { sid: fullSid, body: { intervals: [] } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(0)
    expect(Array.isArray(body.categories)).toBe(true)
  })

  // --- overview (mailer:read) ---
  it('GET overview 401 without a session', async () => {
    const res = await overview.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/overview') as any)
    expect(res.status).toBe(401)
  })

  it('GET overview 403 for an admin lacking mailer:read', async () => {
    const res = await overview.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/overview', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('GET overview 200 returns the aggregate payload shape', async () => {
    const res = await overview.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/overview', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('period')
    expect(body).toHaveProperty('total_campaigns')
    expect(Array.isArray(body.campaigns)).toBe(true)
  })
})

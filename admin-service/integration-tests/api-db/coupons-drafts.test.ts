// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — coupons/[id]/draft (GET/POST/PATCH/DELETE) and
// coupons/[id]/publish (POST). All require coupons:write. Exercises the real coupon_drafts +
// draft_locks tables through createDraft/saveDraftContent/publishCouponDraft against jeffi_test.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin coupons draft + publish API (real DB)', () => {
  let draftGET: (req: any, ctx: any) => Promise<Response>
  let draftPOST: (req: any, ctx: any) => Promise<Response>
  let draftPATCH: (req: any, ctx: any) => Promise<Response>
  let draftDELETE: (req: any, ctx: any) => Promise<Response>
  let publishPOST: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const couponId = crypto.randomUUID()
  const code = `DRAFT${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  const ctx = { params: Promise.resolve({ id: couponId }) }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const draft = await import('@admin/app/api/(admin)/admin/coupons/[id]/draft/route')
    const publish = await import('@admin/app/api/(admin)/admin/coupons/[id]/publish/route')
    draftGET = draft.GET as any
    draftPOST = draft.POST as any
    draftPATCH = draft.PATCH as any
    draftDELETE = draft.DELETE as any
    publishPOST = publish.POST as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    await db.query(`INSERT INTO coupons (id, code, discount_type, discount_value, is_active) VALUES ($1,$2,'percentage',10,true)`, [couponId, code])
  })

  afterAll(async () => {
    await db.query(`DELETE FROM coupon_drafts WHERE coupon_id=$1`, [couponId]).catch(() => {})
    await db.query(`DELETE FROM coupons WHERE id=$1`, [couponId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // --- draft route auth gate ---
  it('draft GET 401 without a session', async () => {
    const res = await draftGET(await apiRequest('GET', `http://localhost/api/admin/coupons/${couponId}/draft`) as any, ctx)
    expect(res.status).toBe(401)
  })

  it('draft GET 403 for an admin lacking coupons:write', async () => {
    const res = await draftGET(await apiRequest('GET', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: narrowSid }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('draft GET 200 returns an (initially empty) drafts list', async () => {
    const res = await draftGET(await apiRequest('GET', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.drafts)).toBe(true)
  })

  // --- draft POST (create) ---
  it('draft POST 404 for a non-existent coupon', async () => {
    const ghost = crypto.randomUUID()
    const res = await draftPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${ghost}/draft`, { sid: fullSid, body: {} }) as any, { params: Promise.resolve({ id: ghost }) })
    expect(res.status).toBe(404)
  })

  let draftId = ''
  it('draft POST 200 creates a draft (row lands in coupon_drafts)', async () => {
    const res = await draftPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: fullSid, body: { title: 'My edit' } }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    draftId = body.draftId
    expect(draftId).toBeTruthy()
    const rows = await db.query(`SELECT coupon_id FROM coupon_drafts WHERE id=$1`, [draftId])
    expect(rows.rows[0].coupon_id).toBe(couponId)
  })

  it('draft POST again (no new flag) returns the existing draft', async () => {
    const res = await draftPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.existing).toBe(true)
    expect(body.draftId).toBe(draftId)
  })

  // --- draft PATCH (autosave) ---
  it('draft PATCH 400 when draftId/fields are missing', async () => {
    const res = await draftPATCH(await apiRequest('PATCH', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('draft PATCH 404 when the draft belongs to another coupon', async () => {
    const res = await draftPATCH(await apiRequest('PATCH', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: fullSid, body: { draftId: crypto.randomUUID(), fields: { description: 'x' } } }) as any, ctx)
    expect(res.status).toBe(404)
  })

  it('draft PATCH 200 autosaves fields (persisted to coupon_drafts.fields)', async () => {
    const res = await draftPATCH(await apiRequest('PATCH', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: fullSid, body: { draftId, fields: { description: 'Holiday sale', discount_value: 20 } } }) as any, ctx)
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT fields FROM coupon_drafts WHERE id=$1`, [draftId])
    expect(rows.rows[0].fields.description).toBe('Holiday sale')
  })

  // --- publish POST ---
  it('publish POST 401 without a session', async () => {
    const res = await publishPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/publish?draft=${draftId}`, { body: {} }) as any, ctx)
    expect(res.status).toBe(401)
  })

  it('publish POST 403 for an admin lacking coupons:write', async () => {
    const res = await publishPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/publish?draft=${draftId}`, { sid: narrowSid, body: {} }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('publish POST 400 when no draft id is given', async () => {
    const res = await publishPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/publish`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('publish POST 404 for an unknown draft', async () => {
    const ghost = crypto.randomUUID()
    const res = await publishPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/publish?draft=${ghost}`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(404)
  })

  it('publish POST 200 merges the draft into live (verified on the coupons row)', async () => {
    const res = await publishPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/publish?draft=${draftId}`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const rows = await db.query(`SELECT description, discount_value FROM coupons WHERE id=$1`, [couponId])
    expect(rows.rows[0].description).toBe('Holiday sale')
    expect(Number(rows.rows[0].discount_value)).toBe(20)
    // The draft is consumed by publish.
    const left = await db.query(`SELECT 1 FROM coupon_drafts WHERE id=$1`, [draftId])
    expect(left.rows.length).toBe(0)
  })

  // --- draft DELETE (discard) ---
  it('draft DELETE 400 when no draft query param is given', async () => {
    const res = await draftDELETE(await apiRequest('DELETE', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('draft DELETE 200 discards a freshly-created draft (row removed)', async () => {
    const created = await draftPOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/draft`, { sid: fullSid, body: { new: true } }) as any, ctx)
    const { draftId: newId } = await created.json()
    const res = await draftDELETE(await apiRequest('DELETE', `http://localhost/api/admin/coupons/${couponId}/draft?draft=${newId}`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT 1 FROM coupon_drafts WHERE id=$1`, [newId])
    expect(rows.rows.length).toBe(0)
  })
})

// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — admin campaigns SCENARIOS routes.
// Real authenticateAdmin → resolveSession → hasScope chain + real scenarios/custom_scenarios/
// scenario_audit_log reads & writes and the READ ONLY dry-run preview against jeffi_test.
// scenarios/generate is skipped (proxies to the AI client). scenarios/drafts/* are thin json-draft
// library wrappers (not campaign-specific logic) — skipped, see report.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// A safe audience SELECT satisfying validateScenarioSql: only u.id, the $1/$2/$3 binds, the frequency-cap
// NOT EXISTS clause and a trailing LIMIT $3.
const VALID_AUDIENCE_SQL =
  "SELECT u.id FROM users u WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.marketing_opt_out = FALSE AND u.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = $1 AND ecs.user_id = u.id AND ecs.sent_at > NOW() - ($2 || ' days')::interval) LIMIT $3"

describe.skipIf(!API_DB_ENABLED)('admin campaigns scenarios API — list/detail/create/patch/delete/dry-run (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let listR: any
  let detailR: any
  let createR: any
  let dryRunR: any
  let fullSid = ''
  let narrowSid = ''

  const sfx = crypto.randomBytes(5).toString('hex')
  const customKind = `test_scn_${sfx}` // a custom scenario we create via the API
  const ctx = (k: string) => ({ params: Promise.resolve({ kind: k }) })

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    listR = await import('@admin/app/api/(admin)/admin/campaigns/scenarios/route')
    detailR = await import('@admin/app/api/(admin)/admin/campaigns/scenarios/[kind]/route')
    createR = await import('@admin/app/api/(admin)/admin/campaigns/scenarios/create/route')
    dryRunR = await import('@admin/app/api/(admin)/admin/campaigns/scenarios/dry-run/route')

    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
  })

  afterAll(async () => {
    // custom_scenarios/scenarios FK cascade handles custom_scenarios; drop both to be safe.
    await db.query(`DELETE FROM custom_scenarios WHERE kind=$1`, [customKind]).catch(() => {})
    await db.query(`DELETE FROM scenarios WHERE kind=$1`, [customKind]).catch(() => {})
    await db.query(`DELETE FROM scenario_audit_log WHERE scenario_kind=$1 OR admin_id=$2`, [customKind, FIXTURES.adminId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // --- GET /scenarios (campaigns:read) ---
  it('GET list 401 without a session', async () => {
    const res = await listR.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/scenarios') as any)
    expect(res.status).toBe(401)
  })

  it('GET list 403 for an admin lacking campaigns:read', async () => {
    const res = await listR.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/scenarios', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('GET list 200 returns builtin scenarios', async () => {
    const res = await listR.GET(await apiRequest('GET', 'http://localhost/api/admin/campaigns/scenarios', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.scenarios)).toBe(true)
    expect(body.scenarios.some((s: any) => s.type === 'builtin')).toBe(true)
  })

  // --- POST /scenarios/create (campaigns:write) ---
  it('POST create 401 without a session', async () => {
    const res = await createR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/create', { body: {} }) as any)
    expect(res.status).toBe(401)
  })

  it('POST create 403 for an admin lacking campaigns:write', async () => {
    const res = await createR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/create', { sid: narrowSid, body: {} }) as any)
    expect(res.status).toBe(403)
  })

  it('POST create 400 when required fields are missing', async () => {
    const res = await createR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/create', { sid: fullSid, body: { name: 'x' } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST create 400 on unsafe SQL (banned keyword)', async () => {
    const res = await createR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/create', {
      sid: fullSid,
      body: { name: `Bad ${sfx}`, kind: `bad_${sfx}`, ai_prompt: 'p', generated_sql: 'DELETE FROM users', dry_run_count: 1 },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('POST create 200 writes scenarios + custom_scenarios rows (verified in the tables)', async () => {
    const res = await createR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/create', {
      sid: fullSid,
      body: { name: `Test Scenario ${sfx}`, kind: customKind, ai_prompt: 'customers with an email', generated_sql: VALID_AUDIENCE_SQL, dry_run_count: 3, parameters: { sendCooldown: 0 } },
    }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.kind).toBe(customKind)
    const s = await db.query(`SELECT kind FROM scenarios WHERE kind=$1`, [customKind])
    expect(s.rows.length).toBe(1)
    const c = await db.query(`SELECT enabled, dry_run_count FROM custom_scenarios WHERE kind=$1`, [customKind])
    expect(c.rows[0].enabled).toBe(false)
    expect(c.rows[0].dry_run_count).toBe(3)
  })

  it('POST create 409 on a duplicate kind', async () => {
    const res = await createR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/create', {
      sid: fullSid,
      body: { name: `Dup ${sfx}`, kind: customKind, ai_prompt: 'p', generated_sql: VALID_AUDIENCE_SQL, dry_run_count: 1 },
    }) as any)
    expect(res.status).toBe(409)
  })

  // --- GET/PATCH/DELETE /scenarios/[kind] (campaigns:read / campaigns:write) ---
  it('GET detail 403 for an admin lacking campaigns:read', async () => {
    const res = await detailR.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/scenarios/${customKind}`, { sid: narrowSid }) as any, ctx(customKind))
    expect(res.status).toBe(403)
  })

  it('GET detail 404 for an unknown custom scenario', async () => {
    const res = await detailR.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/scenarios/nope_${sfx}`, { sid: fullSid }) as any, ctx(`nope_${sfx}`))
    expect(res.status).toBe(404)
  })

  it('GET detail 200 returns the created custom scenario', async () => {
    const res = await detailR.GET(await apiRequest('GET', `http://localhost/api/admin/campaigns/scenarios/${customKind}`, { sid: fullSid }) as any, ctx(customKind))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scenario.kind).toBe(customKind)
    expect(body.scenario.type).toBe('custom')
    expect(Array.isArray(body.campaigns)).toBe(true)
  })

  it('PATCH detail 403 for an admin lacking campaigns:write', async () => {
    const res = await detailR.PATCH(await apiRequest('PATCH', `http://localhost/api/admin/campaigns/scenarios/${customKind}`, { sid: narrowSid, body: { enabled: true } }) as any, ctx(customKind))
    expect(res.status).toBe(403)
  })

  it('PATCH detail 400 on a built-in scenario', async () => {
    // abandoned_cart is a registered builtin → cannot be modified.
    const res = await detailR.PATCH(await apiRequest('PATCH', 'http://localhost/api/admin/campaigns/scenarios/abandoned_cart', { sid: fullSid, body: { enabled: false } }) as any, ctx('abandoned_cart'))
    expect(res.status).toBe(400)
  })

  it('PATCH detail 200 enables the custom scenario (verified in the table)', async () => {
    const res = await detailR.PATCH(await apiRequest('PATCH', `http://localhost/api/admin/campaigns/scenarios/${customKind}`, { sid: fullSid, body: { enabled: true, description: 'now on' } }) as any, ctx(customKind))
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT enabled, description FROM custom_scenarios WHERE kind=$1`, [customKind])
    expect(rows.rows[0].enabled).toBe(true)
    expect(rows.rows[0].description).toBe('now on')
  })

  it('DELETE detail 400 on a built-in scenario', async () => {
    const res = await detailR.DELETE(await apiRequest('DELETE', 'http://localhost/api/admin/campaigns/scenarios/abandoned_cart', { sid: fullSid }) as any, ctx('abandoned_cart'))
    expect(res.status).toBe(400)
  })

  it('DELETE detail 200 removes the custom scenario', async () => {
    const res = await detailR.DELETE(await apiRequest('DELETE', `http://localhost/api/admin/campaigns/scenarios/${customKind}`, { sid: fullSid }) as any, ctx(customKind))
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT 1 FROM scenarios WHERE kind=$1`, [customKind])
    expect(rows.rows.length).toBe(0)
  })

  // --- POST /scenarios/dry-run (campaigns:write) ---
  it('POST dry-run 401 without a session', async () => {
    const res = await dryRunR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/dry-run', { body: { sql: VALID_AUDIENCE_SQL } }) as any)
    expect(res.status).toBe(401)
  })

  it('POST dry-run 403 for an admin lacking campaigns:write', async () => {
    const res = await dryRunR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/dry-run', { sid: narrowSid, body: { sql: VALID_AUDIENCE_SQL } }) as any)
    expect(res.status).toBe(403)
  })

  it('POST dry-run 400 when sql is missing', async () => {
    const res = await dryRunR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/dry-run', { sid: fullSid, body: {} }) as any)
    expect(res.status).toBe(400)
  })

  it('POST dry-run 400 on unsafe sql', async () => {
    const res = await dryRunR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/dry-run', { sid: fullSid, body: { sql: 'SELECT * FROM users' } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST dry-run 200 runs the READ ONLY preview and returns a count (+ audit row)', async () => {
    const res = await dryRunR.POST(await apiRequest('POST', 'http://localhost/api/admin/campaigns/scenarios/dry-run', { sid: fullSid, body: { sql: VALID_AUDIENCE_SQL } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.count).toBe('number')
    expect(Array.isArray(body.sample)).toBe(true)
    const audit = await db.query(`SELECT 1 FROM scenario_audit_log WHERE admin_id=$1 AND action='dry_run'`, [FIXTURES.adminId])
    expect(audit.rows.length).toBeGreaterThanOrEqual(1)
  })
})

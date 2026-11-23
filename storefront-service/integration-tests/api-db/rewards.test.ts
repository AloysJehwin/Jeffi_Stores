// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront rewards game routes:
//   GET  /api/rewards/game/[gameKey]        — play state for the signed-in customer
//   POST /api/rewards/game/[gameKey]/play   — play once per period, issue a coupon
// Real customer session, real handlers, real SQL side-effects (reward_game_plays + coupons)
// asserted against jeffi_test. No tenant headers → flagship path → customerProgramsAllowed() true.
// Opt-in via API_DB=1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('rewards game API (real DB)', () => {
  let GET: (req: any, ctx: any) => Promise<Response>
  let POST: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId

  // A real, playable, once-only rewards_game section seeded for this file.
  const gameKey = '11111111-2222-4333-8444-555566667777'
  const sectionId = `00000000-0000-4000-c000-${uniqueSuffix().padStart(12, '0')}`
  const params = (key: string) => ({ params: Promise.resolve({ gameKey: key }) })

  async function liveCouponIds(): Promise<string[]> {
    const rows = await db.queryMany<{ id: string }>(
      `SELECT id FROM coupons WHERE generated_for_user_id = $1 AND generated_for_campaign = $2`,
      [userId, `reward_game:${gameKey}`]
    )
    return rows.map(r => r.id)
  }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    GET = (await import('@storefront/app/api/(public)/rewards/game/[gameKey]/route')).GET as any
    POST = (await import('@storefront/app/api/(public)/rewards/game/[gameKey]/play/route')).POST as any
    ;({ sid } = await makeCustomerSession(auth, userId))

    // Clean stale rows from a prior run (plays FK coupons via SET NULL; delete plays first).
    await db.query('DELETE FROM reward_game_plays WHERE game_key = $1 AND user_id = $2', [gameKey, userId])
    await db.query('DELETE FROM coupons WHERE generated_for_user_id = $1 AND generated_for_campaign = $2', [
      userId,
      `reward_game:${gameKey}`,
    ])

    // Live rewards_game section: a fixed prize (issues a coupon) + a no-win prize. Two prizes = playable.
    await db.query(
      `INSERT INTO homepage_sections (id, type, is_active, config)
       VALUES ($1, 'rewards_game', true, $2::jsonb)`,
      [
        sectionId,
        JSON.stringify({
          gameKey,
          mode: 'wheel',
          playLimit: 'once',
          prizes: [
            { id: 'win', label: 'Fiver off', kind: 'fixed', value: 5, weight: 1, validDays: 30 },
            { id: 'lose', label: 'No luck', kind: 'none', weight: 1 },
          ],
        }),
      ]
    )
  })

  afterAll(async () => {
    await db.query('DELETE FROM reward_game_plays WHERE game_key = $1', [gameKey]).catch(() => {})
    await db
      .query('DELETE FROM coupons WHERE generated_for_user_id = $1 AND generated_for_campaign = $2', [
        userId,
        `reward_game:${gameKey}`,
      ])
      .catch(() => {})
    await db.query('DELETE FROM homepage_sections WHERE id = $1', [sectionId]).catch(() => {})
    await endPool()
  })

  // ---- GET state ----

  it('GET 404 for a non-uuid gameKey (never touches auth)', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/rewards/game/not-a-uuid', { sid }) as any, params('not-a-uuid'))
    expect(res.status).toBe(404)
  })

  it('GET 401 without a session', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/rewards/game/${gameKey}`) as any, params(gameKey))
    expect(res.status).toBe(401)
  })

  it('GET 404 for an unknown (well-formed) gameKey', async () => {
    const other = '99999999-8888-4777-8666-555544443333'
    const res = await GET(await apiRequest('GET', `http://localhost/api/rewards/game/${other}`, { sid }) as any, params(other))
    expect(res.status).toBe(404)
  })

  it('GET 200 before any play: canPlay true, no last play', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/rewards/game/${gameKey}`, { sid }) as any, params(gameKey))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.canPlay).toBe(true)
    expect(body.nextPlayAt).toBeNull()
    expect(body.lastPlay).toBeNull()
  })

  // ---- POST play ----

  it('POST 404 for a non-uuid gameKey', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/rewards/game/bad/play', { sid }) as any, params('bad'))
    expect(res.status).toBe(404)
  })

  it('POST 401 without a session', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/rewards/game/${gameKey}/play`) as any, params(gameKey))
    expect(res.status).toBe(401)
  })

  it('POST 404 for an unknown gameKey', async () => {
    const other = '99999999-8888-4777-8666-555544443333'
    const res = await POST(await apiRequest('POST', `http://localhost/api/rewards/game/${other}/play`, { sid }) as any, params(other))
    expect(res.status).toBe(404)
  })

  it('POST play inserts a real play row and, for a win, a real coupon', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/rewards/game/${gameKey}/play`, { sid }) as any, params(gameKey))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.repeated).toBe(false)
    expect(['win', 'lose']).toContain(body.play.prizeId)

    // Real side-effect: exactly one play row for this game+user (once-only period).
    const plays = await db.queryMany<{ prize_id: string; coupon_id: string | null }>(
      'SELECT prize_id, coupon_id FROM reward_game_plays WHERE game_key = $1 AND user_id = $2',
      [gameKey, userId]
    )
    expect(plays.length).toBe(1)
    expect(plays[0].prize_id).toBe(body.play.prizeId)

    // A 'fixed' prize mints a coupon linked to the play; a 'none' prize does not.
    if (body.play.prizeId === 'win') {
      expect(body.play.coupon).toBeTruthy()
      expect(plays[0].coupon_id).toBeTruthy()
      const coupons = await liveCouponIds()
      expect(coupons).toContain(plays[0].coupon_id)
      expect(coupons.length).toBe(1)
    } else {
      expect(body.play.coupon).toBeNull()
      expect(plays[0].coupon_id).toBeNull()
      expect((await liveCouponIds()).length).toBe(0)
    }
  })

  it('POST again in the same period is idempotent: repeated, same prize, no second coupon', async () => {
    const before = await db.queryOne<{ prize_id: string; coupon_id: string | null }>(
      'SELECT prize_id, coupon_id FROM reward_game_plays WHERE game_key = $1 AND user_id = $2',
      [gameKey, userId]
    )
    const res = await POST(await apiRequest('POST', `http://localhost/api/rewards/game/${gameKey}/play`, { sid }) as any, params(gameKey))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.repeated).toBe(true)
    expect(body.play.prizeId).toBe(before!.prize_id)

    // Still one play row, still (at most) one coupon — no second coupon issued.
    const n = await db.queryCount('SELECT count(*) FROM reward_game_plays WHERE game_key = $1 AND user_id = $2', [gameKey, userId])
    expect(n).toBe(1)
    expect((await liveCouponIds()).length).toBe(before!.coupon_id ? 1 : 0)
  })

  it('GET after playing: canPlay false, lastPlay reflects the stored row', async () => {
    const stored = await db.queryOne<{ prize_id: string }>(
      'SELECT prize_id FROM reward_game_plays WHERE game_key = $1 AND user_id = $2',
      [gameKey, userId]
    )
    const res = await GET(await apiRequest('GET', `http://localhost/api/rewards/game/${gameKey}`, { sid }) as any, params(gameKey))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.canPlay).toBe(false)
    expect(body.lastPlay).toBeTruthy()
    expect(body.lastPlay.prizeId).toBe(stored!.prize_id)
  })
})

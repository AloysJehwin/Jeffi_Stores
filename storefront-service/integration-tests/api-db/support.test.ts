// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — storefront support route group (public).
// Real customer session + real handlers + SQL side-effects asserted against jeffi_test. Opt-in via API_DB=1.
// Covered: sessions (GET/POST), sessions/[id] (GET/PATCH close), messages (GET + validation/guard),
// receipts, typing, heartbeat, language, actions/[actionId]. ML/agent happy-paths (messages POST that
// calls the assistant, language background translation) are not driven; see the SKIP note at the bottom.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('support API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId
  const sessionIds: string[] = []

  // Routes under test (dynamic-imported after requireTestDb)
  let sessions: typeof import('@storefront/app/api/(public)/support/sessions/route')
  let session1: typeof import('@storefront/app/api/(public)/support/sessions/[sessionId]/route')
  let messages: typeof import('@storefront/app/api/(public)/support/sessions/[sessionId]/messages/route')
  let receipts: typeof import('@storefront/app/api/(public)/support/sessions/[sessionId]/receipts/route')
  let typing: typeof import('@storefront/app/api/(public)/support/sessions/[sessionId]/typing/route')
  let heartbeat: typeof import('@storefront/app/api/(public)/support/sessions/[sessionId]/heartbeat/route')
  let language: typeof import('@storefront/app/api/(public)/support/sessions/[sessionId]/language/route')
  let actions: typeof import('@storefront/app/api/(public)/support/sessions/[sessionId]/actions/[actionId]/route')

  const p = (sessionId: string) => Promise.resolve({ sessionId })
  const p2 = (sessionId: string, actionId: string) => Promise.resolve({ sessionId, actionId })

  // Seed a bare open support session for the fixture customer; returns its id.
  async function seedSession(opts: { status?: 'open' | 'closed'; lang?: string | null; channel?: string } = {}): Promise<string> {
    const r = await db.queryOne<{ id: string }>(
      `INSERT INTO support_sessions (user_id, channel, handler, status, customer_lang, last_message_at, ticket_number)
       VALUES ($1, $2, 'ai', $3, $4, now(), $5) RETURNING id`,
      [userId, opts.channel ?? 'web', opts.status ?? 'open', opts.lang ?? null, 'SUP-TEST-' + crypto.randomBytes(4).toString('hex')]
    )
    sessionIds.push(r!.id)
    return r!.id
  }

  async function seedMessage(sessionId: string, sender: string, text: string): Promise<string> {
    const r = await db.queryOne<{ id: string }>(
      `INSERT INTO support_messages (session_id, sender, message, channel, status) VALUES ($1, $2, $3, 'web', 'sent') RETURNING id`,
      [sessionId, sender, text]
    )
    return r!.id
  }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    sessions = await import('@storefront/app/api/(public)/support/sessions/route')
    session1 = await import('@storefront/app/api/(public)/support/sessions/[sessionId]/route')
    messages = await import('@storefront/app/api/(public)/support/sessions/[sessionId]/messages/route')
    receipts = await import('@storefront/app/api/(public)/support/sessions/[sessionId]/receipts/route')
    typing = await import('@storefront/app/api/(public)/support/sessions/[sessionId]/typing/route')
    heartbeat = await import('@storefront/app/api/(public)/support/sessions/[sessionId]/heartbeat/route')
    language = await import('@storefront/app/api/(public)/support/sessions/[sessionId]/language/route')
    actions = await import('@storefront/app/api/(public)/support/sessions/[sessionId]/actions/[actionId]/route')
    ;({ sid } = await makeCustomerSession(auth, userId))
    // Start clean: no stray open session for this fixture user.
    await db.query('DELETE FROM support_sessions WHERE user_id = $1', [userId])
  })

  afterAll(async () => {
    await db.query('DELETE FROM support_sessions WHERE user_id = $1', [userId]).catch(() => {})
    await endPool()
  })

  // ---- /support/sessions ----
  it('POST /support/sessions opens a real session (first call) and is reused on the next', async () => {
    const r1 = await sessions.POST(await apiRequest('POST', 'http://localhost/api/support/sessions', { sid, body: {} }) as any)
    expect(r1.status).toBe(200)
    const b1 = await r1.json()
    expect(b1.session?.id).toBeTruthy()
    const row = await db.queryOne<{ user_id: string; status: string }>('SELECT user_id, status FROM support_sessions WHERE id = $1', [b1.session.id])
    expect(row?.user_id).toBe(userId)
    expect(row?.status).toBe('open')
    sessionIds.push(b1.session.id)

    // Second POST reuses the same open session, not a new row.
    const r2 = await sessions.POST(await apiRequest('POST', 'http://localhost/api/support/sessions', { sid, body: {} }) as any)
    const b2 = await r2.json()
    expect(b2.session.id).toBe(b1.session.id)
    const n = await db.queryCount('SELECT count(*) FROM support_sessions WHERE user_id = $1 AND status = $2', [userId, 'open'])
    expect(n).toBe(1)
  })

  it('GET /support/sessions returns the customer open session', async () => {
    const r = await sessions.GET(await apiRequest('GET', 'http://localhost/api/support/sessions', { sid }) as any)
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.session?.id).toBeTruthy()
  })

  it('GET /support/sessions is 401 for an unauthenticated request', async () => {
    const r = await sessions.GET(await apiRequest('GET', 'http://localhost/api/support/sessions', {}) as any)
    expect(r.status).toBe(401)
  })

  it('POST /support/sessions is 401 for an unauthenticated request', async () => {
    const r = await sessions.POST(await apiRequest('POST', 'http://localhost/api/support/sessions', { body: {} }) as any)
    expect(r.status).toBe(401)
  })

  // ---- /support/sessions/[sessionId] ----
  it('GET /support/sessions/[id] returns the session for its owner', async () => {
    const id = await seedSession()
    const r = await session1.GET(await apiRequest('GET', `http://localhost/api/support/sessions/${id}`, { sid }) as any, { params: p(id) })
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.session?.id).toBe(id)
  })

  it('GET /support/sessions/[id] is 404 when the session is not the caller\'s', async () => {
    const other = crypto.randomUUID()
    const r = await session1.GET(await apiRequest('GET', `http://localhost/api/support/sessions/${other}`, { sid }) as any, { params: p(other) })
    expect(r.status).toBe(404)
  })

  it('GET /support/sessions/[id] is 401 without auth', async () => {
    const id = await seedSession()
    const r = await session1.GET(await apiRequest('GET', `http://localhost/api/support/sessions/${id}`, {}) as any, { params: p(id) })
    expect(r.status).toBe(401)
  })

  it('PATCH /support/sessions/[id] closes the chat (real status flip)', async () => {
    const id = await seedSession()
    const r = await session1.PATCH(await apiRequest('PATCH', `http://localhost/api/support/sessions/${id}`, { sid, body: { status: 'closed' } }) as any, { params: p(id) })
    expect(r.status).toBe(200)
    const row = await db.queryOne<{ status: string; closed_at: string | null }>('SELECT status, closed_at FROM support_sessions WHERE id = $1', [id])
    expect(row?.status).toBe('closed')
    expect(row?.closed_at).toBeTruthy()
  })

  it('PATCH /support/sessions/[id] rejects a non-closed status with 400', async () => {
    const id = await seedSession()
    const r = await session1.PATCH(await apiRequest('PATCH', `http://localhost/api/support/sessions/${id}`, { sid, body: { status: 'open' } }) as any, { params: p(id) })
    expect(r.status).toBe(400)
  })

  // ---- messages ----
  it('GET /support/sessions/[id]/messages returns seeded messages for the owner', async () => {
    const id = await seedSession()
    await seedMessage(id, 'customer', 'hello there')
    await seedMessage(id, 'ai', 'hi, how can I help')
    const r = await messages.GET(await apiRequest('GET', `http://localhost/api/support/sessions/${id}/messages?v=2`, { sid }) as any, { params: p(id) })
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(Array.isArray(b.messages)).toBe(true)
    expect(b.messages.length).toBe(2)
    expect(b.messages.some((m: any) => m.text === 'hello there')).toBe(true)
  })

  it('GET messages is 404 for a session not owned by the caller', async () => {
    const other = crypto.randomUUID()
    const r = await messages.GET(await apiRequest('GET', `http://localhost/api/support/sessions/${other}/messages`, { sid }) as any, { params: p(other) })
    expect(r.status).toBe(404)
  })

  it('POST messages with neither text nor attachments returns 400 (real validation)', async () => {
    const id = await seedSession()
    const r = await messages.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/messages`, { sid, body: {} }) as any, { params: p(id) })
    expect(r.status).toBe(400)
  })

  it('POST messages to a closed chat returns 409', async () => {
    const id = await seedSession({ status: 'closed' })
    const r = await messages.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/messages`, { sid, body: { message: 'hi' } }) as any, { params: p(id) })
    expect(r.status).toBe(409)
  })

  it('POST messages is 401 without auth', async () => {
    const id = await seedSession()
    const r = await messages.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/messages`, { body: { message: 'hi' } }) as any, { params: p(id) })
    expect(r.status).toBe(401)
  })

  // ---- receipts ----
  it('POST receipts marks an ai message read (real read_at side-effect)', async () => {
    const id = await seedSession()
    const mid = await seedMessage(id, 'ai', 'an answer')
    const r = await receipts.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/receipts`, { sid, body: { state: 'read', upTo: mid } }) as any, { params: p(id) })
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.updated).toBe(1)
    const row = await db.queryOne<{ read_at: string | null; status: string }>('SELECT read_at, status FROM support_messages WHERE id = $1', [mid])
    expect(row?.read_at).toBeTruthy()
    expect(row?.status).toBe('read')
  })

  it('POST receipts with a bad state returns 400', async () => {
    const id = await seedSession()
    const r = await receipts.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/receipts`, { sid, body: { state: 'nope', upTo: crypto.randomUUID() } }) as any, { params: p(id) })
    expect(r.status).toBe(400)
  })

  it('POST receipts with a non-uuid upTo returns 400', async () => {
    const id = await seedSession()
    const r = await receipts.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/receipts`, { sid, body: { state: 'read', upTo: 'not-a-uuid' } }) as any, { params: p(id) })
    expect(r.status).toBe(400)
  })

  // ---- typing ----
  it('POST typing is accepted for the owner', async () => {
    const id = await seedSession()
    const r = await typing.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/typing`, { sid, body: { on: true } }) as any, { params: p(id) })
    expect(r.status).toBe(200)
    expect((await r.json()).ok).toBe(true)
  })

  it('POST typing is 404 for a foreign session', async () => {
    const other = crypto.randomUUID()
    const r = await typing.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${other}/typing`, { sid, body: { on: true } }) as any, { params: p(other) })
    expect(r.status).toBe(404)
  })

  // ---- heartbeat ----
  it('POST heartbeat updates customer_last_seen_at (real side-effect)', async () => {
    const id = await seedSession()
    await db.query('UPDATE support_sessions SET customer_last_seen_at = NULL WHERE id = $1', [id])
    const r = await heartbeat.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/heartbeat`, { sid, body: {} }) as any, { params: p(id) })
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.ok).toBe(true)
    const row = await db.queryOne<{ customer_last_seen_at: string | null }>('SELECT customer_last_seen_at FROM support_sessions WHERE id = $1', [id])
    expect(row?.customer_last_seen_at).toBeTruthy()
  })

  it('POST heartbeat on a closed chat reports closed without touching presence', async () => {
    const id = await seedSession({ status: 'closed' })
    const r = await heartbeat.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/heartbeat`, { sid, body: {} }) as any, { params: p(id) })
    expect(r.status).toBe(200)
    expect((await r.json()).closed).toBe(true)
  })

  // ---- language ----
  it('POST language sets customer_lang on the session (real side-effect)', async () => {
    const id = await seedSession({ lang: null })
    const r = await language.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/language`, { sid, body: { lang: 'hi' } }) as any, { params: p(id) })
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.lang).toBe('hi')
    const row = await db.queryOne<{ customer_lang: string | null }>('SELECT customer_lang FROM support_sessions WHERE id = $1', [id])
    expect(row?.customer_lang).toBe('hi')
  })

  it('POST language rejects an unsupported language with 400', async () => {
    const id = await seedSession()
    const r = await language.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/language`, { sid, body: { lang: 'zz' } }) as any, { params: p(id) })
    expect(r.status).toBe(400)
  })

  // ---- actions/[actionId] ----
  it('POST actions declines a pending action (real status flip)', async () => {
    const id = await seedSession({ lang: 'en' })
    const action = await db.queryOne<{ id: string }>(
      `INSERT INTO support_ai_actions (session_id, kind, args, status, awaiting) VALUES ($1, 'reply', '{}'::jsonb, 'pending', 'customer') RETURNING id`,
      [id]
    )
    const r = await actions.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/actions/${action!.id}`, { sid, body: { decision: 'decline' } }) as any, { params: p2(id, action!.id) })
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.status).toBe('declined')
    const row = await db.queryOne<{ status: string }>('SELECT status FROM support_ai_actions WHERE id = $1', [action!.id])
    expect(row?.status).toBe('declined')
  })

  it('POST actions with an invalid decision returns 400', async () => {
    const id = await seedSession()
    const r = await actions.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/actions/${crypto.randomUUID()}`, { sid, body: { decision: 'maybe' } }) as any, { params: p2(id, crypto.randomUUID()) })
    expect(r.status).toBe(400)
  })

  it('POST actions for an unknown action id returns 404', async () => {
    const id = await seedSession()
    const r = await actions.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${id}/actions/${crypto.randomUUID()}`, { sid, body: { decision: 'confirm' } }) as any, { params: p2(id, crypto.randomUUID()) })
    expect(r.status).toBe(404)
  })

  it('POST actions is 404 for a session not owned by the caller', async () => {
    const other = crypto.randomUUID()
    const r = await actions.POST(await apiRequest('POST', `http://localhost/api/support/sessions/${other}/actions/${crypto.randomUUID()}`, { sid, body: { decision: 'confirm' } }) as any, { params: p2(other, crypto.randomUUID()) })
    expect(r.status).toBe(404)
  })
})

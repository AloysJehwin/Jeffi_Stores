// @vitest-environment node
//
// DB-backed (jeffi_test): a task agent (the builtin post-order-review under a test name) end to end on real tables.
// The agent is created and activated through the admin routes, jobs are created through the jobs route (deduped on the
// order number), the scheduler (runDueJobs) starts them inside the calling window, and the call is simulated with
// direct calls to the session builder, the tools runner and the events handler (what voice-service's internal routes
// wrap). voice-service's placeCall is mocked; WhatsApp stays in capture mode; nothing is dialled or sent.
// Scenario 1: a delivered prepaid order, rating 5, consent, review link (feedback/request), outcome review_link_sent.
// Scenario 2: another order, rating 2 with a comment -> a staff task, outcome complaint.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const h = vi.hoisted(() => ({ placeCall: vi.fn(), hangupCall: vi.fn() }))
vi.mock('@controller/lib/outreach/voice-client', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/voice-client')>()), placeCall: h.placeCall, hangupCall: h.hangupCall }))

const IST_MS = 330 * 60_000
const PROGRAM = 'showcase-offer'

describe.skipIf(!API_DB_ENABLED)('outreach task agent: post-order-review (real DB, admin routes + scheduler + simulated call)', () => {
  let cp: any
  let db: typeof import('@/lib/shared/db')
  let runtime: typeof import('@controller/lib/outreach/agent/runtime')
  let builtin: typeof import('@controller/lib/outreach/agent/skill/builtin')
  let toolsMod: typeof import('@controller/lib/outreach/tools')
  let events: typeof import('@controller/lib/outreach/call-events')
  let skillsRoute: typeof import('@controller/app/api/(admin)/admin/ecom/outreach/skills/route')
  let skillRoute: typeof import('@controller/app/api/(admin)/admin/ecom/outreach/skills/[id]/route')
  let jobsRoute: typeof import('@controller/app/api/(admin)/admin/ecom/outreach/agents/[id]/jobs/route')

  const suffix = crypto.randomBytes(3).toString('hex')
  const phone = `+9199${String(parseInt(suffix, 16)).padStart(8, '0').slice(0, 8)}`
  const phone10 = phone.slice(-10)
  const userId = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const order1 = { id: crypto.randomUUID(), number: `APIT-${suffix}-1` }
  const order2 = { id: crypto.randomUUID(), number: `APIT-${suffix}-2` }
  const customerName = 'Asha Rao'
  let sid = ''
  let sessionRowId = ''
  let skillId = ''
  let skillSlug = ''
  let programBefore: { enabled: boolean; daily_cap: number; concurrency: number; test_numbers: string[] } | null = null
  let job1 = ''
  let job2 = ''
  let call1 = ''
  let call2 = ''

  // Noon IST tomorrow: inside 09:30-20:30, and after every job's due_at (a job is due when created).
  const istNow = new Date(Date.now() + IST_MS)
  const noonTomorrow = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, 12, 0) - IST_MS)

  const tool = async (callId: string, name: string, args: Record<string, unknown>) => toolsMod.runTool(callId, name, args, noonTomorrow)
  const body = async (res: Response) => ({ status: res.status, json: await res.json() })
  const adminReq = (method: string, path: string, b?: unknown) => apiRequest(method, `http://localhost/api/admin/ecom/outreach/${path}`, { sid, body: b }) as any
  const job = async (id: string) => (await cp.query(`SELECT * FROM outreach_jobs WHERE id = $1`, [id])).rows[0]
  const jobInputs = (o: { number: string }) => ({
    customer_phone: phone,
    customer_name: customerName,
    order_number: o.number,
    ordered_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
  })
  const createJobVia = async (o: { number: string }) => {
    const r = await body(await jobsRoute.POST(await adminReq('POST', `agents/${skillId}/jobs`, { inputs: jobInputs(o) }), { params: Promise.resolve({ id: skillId }) }))
    return r
  }
  const callOf = async (contactId: string) => (await cp.query(`SELECT * FROM outreach_calls WHERE contact_id = $1 ORDER BY created_at DESC, id LIMIT 1`, [contactId])).rows[0]
  const toolEvents = async (callId: string) => (await cp.query(`SELECT * FROM outreach_events WHERE call_id = $1 AND kind = 'tool_call' ORDER BY id`, [callId])).rows

  beforeAll(async () => {
    const url = requireTestDb()
    const cpUrl = process.env.CONTROL_PLANE_DATABASE_URL
    if (cpUrl && new URL(cpUrl).pathname.replace(/^\//, '') !== 'jeffi_test') throw new Error('CONTROL_PLANE_DATABASE_URL must be jeffi_test for this test')
    process.env.CONTROL_PLANE_DATABASE_URL = url
    process.env.OUTREACH_TEST_MODE = '1'
    process.env.VOICE_SERVICE_URL = 'http://voice.invalid:8080'
    h.placeCall.mockImplementation(async (i: { callId: string }) => ({ providerCallId: `p-${i.callId.slice(0, 8)}`, duplicate: false }))
    cp = (await import('@/lib/tenant-registry')).controlPlanePool()
    db = await import('@/lib/shared/db')
    runtime = await import('@controller/lib/outreach/agent/runtime')
    builtin = await import('@controller/lib/outreach/agent/skill/builtin')
    toolsMod = await import('@controller/lib/outreach/tools')
    events = await import('@controller/lib/outreach/call-events')
    skillsRoute = await import('@controller/app/api/(admin)/admin/ecom/outreach/skills/route')
    skillRoute = await import('@controller/app/api/(admin)/admin/ecom/outreach/skills/[id]/route')
    jobsRoute = await import('@controller/app/api/(admin)/admin/ecom/outreach/agents/[id]/jobs/route')
    const auth = await import('@/lib/auth/auth-sessions')
    ;({ sid, id: sessionRowId } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))

    // The program must be enabled and the number a test number (the dialler accepts it in any voice mode); restored in afterAll.
    const ps = await (await import('@controller/lib/outreach/program-state')).getProgramState(PROGRAM)
    programBefore = { enabled: ps.enabled, daily_cap: ps.daily_cap, concurrency: ps.concurrency, test_numbers: ps.test_numbers ?? [] }
    await cp.query(`UPDATE outreach_program_state SET enabled = true, daily_cap = 100000, concurrency = 100000, test_numbers = $2::text[] WHERE program = $1`, [PROGRAM, [...programBefore.test_numbers, phone]])
    // The scheduler claims every due job: park leftovers of earlier runs so only this test's jobs start.
    await cp.query(`UPDATE outreach_jobs SET status = 'cancelled', ended_at = now() WHERE status = 'queued' AND contact_id IN (SELECT id FROM outreach_contacts WHERE phone <> $1)`, [phone])

    // A flagship shopper who chose WhatsApp for order updates, with two delivered prepaid orders.
    await db.query(`INSERT INTO users (id, email, first_name, phone, phone_verified, notification_channel) VALUES ($1, $2, 'Asha', $3, true, 'whatsapp')`, [userId, `apitest-jobs-${suffix}@jeffi.test`, phone10])
    await db.query(`INSERT INTO products (id, sku, name, slug, base_price) VALUES ($1, $2, $3, $4, 499)`, [productId, `APIT-SKU-${suffix}`, `Apitest Kurta ${suffix}`, `apitest-kurta-${suffix}`])
    for (const o of [order1, order2]) {
      await db.query(
        `INSERT INTO orders (id, order_number, user_id, status, payment_status, payment_mode, subtotal, total_amount, customer_phone, created_at, delivered_at)
         VALUES ($1, $2, $3, 'delivered', 'paid', 'prepaid', 499, 499, $4, now() - interval '4 days', now() - interval '2 days')`,
        [o.id, o.number, userId, phone10]
      )
      await db.query(`INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price) VALUES ($1, $2, $3, 1, 499, 499)`, [o.id, productId, `Apitest Kurta ${suffix}`])
    }
  }, 60_000)

  afterAll(async () => {
    if (cp) {
      // The contact cascades its jobs, runs, calls, messages, events and agent tasks; the skill cascades its versions.
      await cp.query(`DELETE FROM outreach_contacts WHERE phone = $1`, [phone]).catch(() => {})
      if (skillId) await cp.query(`DELETE FROM outreach_skills WHERE id = $1`, [skillId]).catch(() => {})
      if (programBefore) {
        await cp.query(`UPDATE outreach_program_state SET enabled = $2, daily_cap = $3, concurrency = $4, test_numbers = $5::text[] WHERE program = $1`, [
          PROGRAM, programBefore.enabled, programBefore.daily_cap, programBefore.concurrency, programBefore.test_numbers,
        ]).catch(() => {})
      }
    }
    if (db) {
      await db.query(`DELETE FROM customer_tasks WHERE user_id = $1`, [userId]).catch(() => {})
      await db.query(`DELETE FROM customer_notes WHERE user_id = $1`, [userId]).catch(() => {})
      await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [[order1.id, order2.id]]).catch(() => {})
      await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [[order1.id, order2.id]]).catch(() => {})
      await db.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => {})
      await db.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {})
      if (sessionRowId) await db.query(`DELETE FROM auth_sessions WHERE id = $1`, [sessionRowId]).catch(() => {})
    }
    await endPool()
  })

  it('creates the agent from the builtin through the admin route and activates it', async () => {
    const builtinSkill = builtin.BUILTIN_SKILLS.find(b => b.slug === 'post-order-review')!
    const content = builtinSkill.content.replace('name: post-order-review', `name: apitest-post-order-review-${suffix}`)
    expect(content).not.toBe(builtinSkill.content)

    const created = await body(await skillsRoute.POST(await adminReq('POST', 'skills', { content })))
    expect(created.status, JSON.stringify(created.json)).toBe(201)
    expect(created.json.validation.ok, JSON.stringify(created.json.validation?.issues)).toBe(true)
    skillId = created.json.skill.id
    skillSlug = created.json.skill.slug

    const patched = await body(await skillRoute.PATCH(await adminReq('PATCH', `skills/${skillId}`, { status: 'active' }), { params: Promise.resolve({ id: skillId }) }))
    expect(patched.status, JSON.stringify(patched.json)).toBe(200)
    expect(patched.json.skill.status).toBe('active')
  }, 60_000)

  it('a job is created from the declared inputs with the order resolved; the same order again is deduped', async () => {
    const first = await createJobVia(order1)
    expect(first.status, JSON.stringify(first.json)).toBe(201)
    expect(first.json.results).toHaveLength(1)
    expect(first.json.results[0]).toMatchObject({ ok: true, created: true, errors: [] })
    job1 = first.json.results[0].jobId

    const row = await job(job1)
    expect(row).toMatchObject({ skill_id: skillId, status: 'queued', source: 'form', source_ref: order1.number })
    expect(row.refs.order).toMatchObject({ number: order1.number, status: 'delivered', paymentMethod: 'prepaid' })
    expect(row.inputs).toMatchObject({ customer_phone: phone, customer_name: customerName, order_number: order1.number })
    const contact = (await cp.query(`SELECT * FROM outreach_contacts WHERE id = $1`, [row.contact_id])).rows[0]
    expect(contact).toMatchObject({ phone, kind: 'shopper', owner_name: customerName })

    const again = await createJobVia(order1)
    expect(again.status).toBe(200)
    expect(again.json.results[0]).toMatchObject({ ok: true, created: false, jobId: job1, errors: [] })
    expect((await cp.query(`SELECT count(*)::int AS n FROM outreach_jobs WHERE skill_id = $1`, [skillId])).rows[0].n).toBe(1)

    // an order that is not this phone's is refused, no job
    const stranger = await body(await jobsRoute.POST(await adminReq('POST', `agents/${skillId}/jobs`, { inputs: { ...jobInputs(order1), order_number: `NOPE-${suffix}` } }), { params: Promise.resolve({ id: skillId }) }))
    expect(stranger.json.results[0]).toMatchObject({ ok: false, created: false })
    expect(stranger.json.results[0].errors.join(' ')).toContain('not found')
  }, 60_000)

  it('scheduler: inside the calling window the job starts, its run is pinned and a call is queued', async () => {
    const sum = await runtime.runDueJobs(noonTomorrow, 100)
    expect(sum.started).toBeGreaterThanOrEqual(1)

    const row = await job(job1)
    expect(row).toMatchObject({ status: 'active', attempts: 1 })
    const runs = (await cp.query(`SELECT * FROM outreach_agent_runs WHERE job_id = $1`, [job1])).rows
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ contact_id: row.contact_id, skill_ref: `${skillSlug}@v1`, status: 'active' })
    expect(runs[0].skill_version_id).toBeTruthy()

    const call = await callOf(row.contact_id)
    call1 = call.id
    expect(call).toMatchObject({ status: 'queued', contact_id: row.contact_id })
    expect(h.placeCall).toHaveBeenLastCalledWith(expect.objectContaining({ callId: call1, to: phone }))
    const jobCalls = (await cp.query(`SELECT * FROM outreach_events WHERE contact_id = $1 AND kind = 'job_call'`, [row.contact_id])).rows
    expect(jobCalls).toHaveLength(1)
    expect(jobCalls[0].data).toMatchObject({ jobId: job1 })
  }, 120_000)

  it('call 1: session carries the order and the tools; rating 5, consent, review link and outcome; the job and run complete', async () => {
    const session = (await runtime.buildVoiceSession(call1, noonTomorrow))!
    expect(session.skillRef).toBe(`${skillSlug}@v1`)
    expect(session.systemPrompt).toContain(order1.number)
    expect(session.tools.map(t => t.name)).toEqual(expect.arrayContaining(['getJob', 'getOrder', 'recordRating', 'recordConsent', 'sendReviewLink', 'setOutcome']))

    await events.handleCallEvent(call1, { type: 'ringing', data: { provider: 'exotel', providerCallId: 'p1' } }, noonTomorrow)
    await events.handleCallEvent(call1, { type: 'answered' }, noonTomorrow)

    const got = await tool(call1, 'getJob', {})
    expect(got.status).toBe(200)
    expect(got.body.ok).toBe(true)
    const data = (got.body as any).data
    expect(data).toMatchObject({ status: 'active', inputs: { order_number: order1.number, customer_name: customerName } })
    expect(data.outcomes).toEqual(expect.arrayContaining(['review_link_sent', 'complaint']))
    // the LLM never sees the full number
    expect(JSON.stringify(data)).not.toContain(phone10)

    const order = await tool(call1, 'getOrder', {})
    expect(order.body.ok).toBe(true)
    expect((order.body as any).data).toMatchObject({ number: order1.number, status: 'delivered', paymentMethod: 'prepaid' })
    expect((order.body as any).data.items).toHaveLength(1)

    const rating = await tool(call1, 'recordRating', { rating: 5 })
    expect(rating.body.ok).toBe(true)
    expect((rating.body as any).data).toMatchObject({ recorded: true, rating: 5, lowRating: false })

    const consent = await tool(call1, 'recordConsent', { whatsapp: true, recording_ack: true, quote: 'yes, send it on WhatsApp' })
    expect(consent.body.ok).toBe(true)
    expect((await cp.query(`SELECT consent_whatsapp_at FROM outreach_contacts WHERE phone = $1`, [phone])).rows[0].consent_whatsapp_at).toBeTruthy()

    const link = await tool(call1, 'sendReviewLink', {})
    expect(link.body.ok, JSON.stringify(link.body)).toBe(true)
    expect((link.body as any).data).toMatchObject({ sent: true, mode: 'captured' })

    const row = await job(job1)
    const msgs = (await cp.query(`SELECT * FROM outreach_messages WHERE contact_id = $1 AND template_slug = 'feedback/request'`, [row.contact_id])).rows
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ direction: 'out', status: 'captured' })
    expect(msgs[0].body.startsWith('[feedback/request]')).toBe(true)
    expect(msgs[0].body).toContain(order1.number)
    // Captured test sends keep the bearer link readable outside production (store/messaging.ts); in production it is '[review link]'.
    expect(msgs[0].body).toMatch(/\[review link\]|\/review\?token=/)

    const done = await tool(call1, 'setOutcome', { outcome: 'review_link_sent' })
    expect(done.body.ok).toBe(true)
    expect(done.body.end).toBe(true)

    const after = await job(job1)
    expect(after).toMatchObject({ status: 'completed', outcome: 'review_link_sent' })
    expect(after.ended_at).toBeTruthy()
    expect((await cp.query(`SELECT status FROM outreach_agent_runs WHERE job_id = $1`, [job1])).rows).toEqual([{ status: 'completed' }])
    expect((await cp.query(`SELECT summary FROM outreach_calls WHERE id = $1`, [call1])).rows[0].summary).toBe('review_link_sent')

    // a rating of 5 makes no staff task; every call is audited, and the review token never reaches the audit rows
    expect((await db.query(`SELECT 1 FROM customer_tasks WHERE user_id = $1 AND source_ref_id = $2`, [userId, `rating:${order1.id}`])).rows).toHaveLength(0)
    const audit = await toolEvents(call1)
    expect(audit.map((e: any) => e.data.tool)).toEqual(['getJob', 'getOrder', 'recordRating', 'recordConsent', 'sendReviewLink', 'setOutcome'])
    expect(audit.every((e: any) => e.data.ok === true)).toBe(true)
    expect(JSON.stringify(audit)).not.toContain('token=')

    await events.handleCallEvent(call1, { type: 'ended', data: { durationS: 75 } }, noonTomorrow)
    expect((await job(job1)).status).toBe('completed')
    expect((await cp.query(`SELECT status FROM outreach_calls WHERE id = $1`, [call1])).rows[0].status).toBe('completed')
  }, 120_000)

  it('a second order, same customer: rating 2 with a comment opens a staff task, outcome complaint completes the job', async () => {
    const created = await createJobVia(order2)
    expect(created.status, JSON.stringify(created.json)).toBe(201)
    expect(created.json.results[0]).toMatchObject({ ok: true, created: true })
    job2 = created.json.results[0].jobId
    expect(job2).not.toBe(job1)
    expect((await job(job2)).refs.order.number).toBe(order2.number)

    // the first job is closed and its call ended, so the phone is free
    await runtime.runDueJobs(noonTomorrow, 100)
    expect((await job(job2))).toMatchObject({ status: 'active', attempts: 1 })
    const call = await callOf((await job(job2)).contact_id)
    call2 = call.id
    expect(call2).not.toBe(call1)
    expect(h.placeCall).toHaveBeenLastCalledWith(expect.objectContaining({ callId: call2, to: phone }))

    const session = (await runtime.buildVoiceSession(call2, noonTomorrow))!
    expect(session.systemPrompt).toContain(order2.number)
    expect(session.systemPrompt).not.toContain(order1.number)
    await events.handleCallEvent(call2, { type: 'answered' }, noonTomorrow)

    const rating = await tool(call2, 'recordRating', { rating: 2, comment: 'arrived broken' })
    expect(rating.body.ok).toBe(true)
    expect((rating.body as any).data).toMatchObject({ recorded: true, rating: 2, lowRating: true, teamWillFollowUp: true })

    const tasks = (await db.query(`SELECT * FROM customer_tasks WHERE user_id = $1 AND source_kind = 'outreach_agent'`, [userId])).rows
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ source_ref_id: `rating:${order2.id}`, priority: 'high', status: 'pending', auto_created: true })
    expect(tasks[0].title).toContain(`#${order2.number}`)
    expect(tasks[0].description).toContain('arrived broken')
    const notes = (await db.query(`SELECT * FROM customer_notes WHERE user_id = $1 AND order_id = $2`, [userId, order2.id])).rows
    expect(notes).toHaveLength(1)
    expect(notes[0].tags).toContain('complaint')
    expect(notes[0].body).toContain('arrived broken')

    // the same rating again is recorded once
    const repeat = await tool(call2, 'recordRating', { rating: 2, comment: 'arrived broken' })
    expect((repeat.body as any).data).toMatchObject({ alreadyRecorded: true })
    expect((await db.query(`SELECT 1 FROM customer_tasks WHERE user_id = $1 AND source_kind = 'outreach_agent'`, [userId])).rows).toHaveLength(1)

    // an outcome the agent does not declare is refused and leaves the job open
    const bogus = await tool(call2, 'setOutcome', { outcome: 'bogus' })
    expect(bogus.body.ok).toBe(false)
    expect((await job(job2)).status).toBe('active')

    const done = await tool(call2, 'setOutcome', { outcome: 'complaint', note: 'arrived broken' })
    expect(done.body.ok).toBe(true)
    expect(done.body.end).toBe(true)
    expect(await job(job2)).toMatchObject({ status: 'completed', outcome: 'complaint' })
    expect((await cp.query(`SELECT status FROM outreach_agent_runs WHERE job_id = $1`, [job2])).rows).toEqual([{ status: 'completed' }])
    // the complaint sent no second review link (the contact still holds only the first job's)
    expect((await cp.query(`SELECT 1 FROM outreach_messages m JOIN outreach_jobs j ON j.contact_id = m.contact_id WHERE j.id = $1 AND m.template_slug = 'feedback/request'`, [job2])).rows).toHaveLength(1)

    await events.handleCallEvent(call2, { type: 'ended', data: { durationS: 60 } }, noonTomorrow)
    expect((await job(job2)).status).toBe('completed')
  }, 120_000)
})

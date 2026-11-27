// @vitest-environment node
//
// DB-backed (jeffi_test): the outreach agent end to end on real tables. A skill uploaded as Markdown (the builtin
// two-call playbook under a test name) drives one test contact: call 1 (consent, preview, details, a callback booked),
// a WhatsApp message (details through the agent loop), the scheduler (the follow-up turn, then the agent's own call
// to the engaged contact), and call 2 (continuing, the publish refused until the site is designed). voice-service is
// replaced by direct calls to the session builder, the tools runner and the events handler; WhatsApp stays in capture
// mode; the AI is a scripted model and the site generation (startRun) is mocked. Nothing is dialled or sent.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb } from '../../../packages/store-core/integration-tests/db/harness'
import { endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const h = vi.hoisted(() => ({ startRun: vi.fn(), placeCall: vi.fn(), hangupCall: vi.fn() }))
vi.mock('@controller/lib/outreach/build/run', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/build/run')>()), startRun: h.startRun }))
vi.mock('@controller/lib/outreach/voice-client', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/voice-client')>()), placeCall: h.placeCall, hangupCall: h.hangupCall }))

const IST_MS = 330 * 60_000
const SKILL_NAME = (suffix: string) => `apitest-two-call-${suffix}`

describe.skipIf(!API_DB_ENABLED)('outreach agent (real DB, scripted model)', () => {
  let cp: any
  let runtime: typeof import('@controller/lib/outreach/agent/runtime')
  let modelMod: typeof import('@controller/lib/outreach/agent/model')
  let store: typeof import('@controller/lib/outreach/agent/skill/store')
  let builtin: typeof import('@controller/lib/outreach/agent/skill/builtin')
  let worker: typeof import('@controller/lib/outreach/worker')
  let toolsMod: typeof import('@controller/lib/outreach/tools')
  let events: typeof import('@controller/lib/outreach/call-events')
  let inbound: typeof import('@controller/lib/outreach/inbound')
  let wa: typeof import('@controller/lib/outreach/whatsapp')
  let prompt: typeof import('@controller/lib/outreach/prompt')

  const suffix = crypto.randomBytes(3).toString('hex')
  const contactId = crypto.randomUUID()
  const listId = crypto.randomUUID()
  const tenantId = crypto.randomUUID()
  const phone = `+9199${String(parseInt(suffix, 16)).padStart(8, '0').slice(0, 8)}`
  const business = `Apitest Bakery ${suffix}`
  let skillId = ''
  let skillSlug = ''
  let systemOwnerExisted = true
  let siteId = ''
  let programBefore: { enabled: boolean; daily_cap: number; concurrency: number } | null = null
  let call1 = ''
  let call2 = ''

  // 17:00 IST tomorrow: the callback the owner asks for; the scheduler runs a minute after it.
  const istNow = new Date(Date.now() + IST_MS)
  const callbackAt = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, 17, 0) - IST_MS)
  const later = new Date(callbackAt.getTime() + 60_000)

  const contact = async () => (await cp.query(`SELECT * FROM outreach_contacts WHERE id = $1`, [contactId])).rows[0]
  const eventsOf = async (kind: string) => (await cp.query(`SELECT * FROM outreach_events WHERE contact_id = $1 AND kind = $2 ORDER BY id`, [contactId, kind])).rows
  const tasks = async () => (await cp.query(`SELECT * FROM outreach_agent_tasks WHERE contact_id = $1 ORDER BY created_at, id`, [contactId])).rows
  const tool = async (callId: string, name: string, args: Record<string, unknown>, at = new Date()) => {
    const r = await toolsMod.runTool(callId, name, args, at)
    return r
  }

  // The scripted brain: WhatsApp saves what the owner said then answers; a follow-up looks at the site and stops.
  const scripted = async (req: any) => {
    const sawTool = req.messages.some((m: any) => m.role === 'tool')
    if (req.channel === 'whatsapp') {
      if (!sawTool) return { content: '', toolCalls: [{ id: 'w1', name: 'addDetails', arguments: { address: 'MG Road, Pune', hours: 'Tue-Sun 8am-9pm' } }], costPaise: 2 }
      return { content: 'Thanks! I have added your address and hours.', toolCalls: [], costPaise: 3 }
    }
    if (!sawTool) return { content: '', toolCalls: [{ id: 'f1', name: 'getSiteStatus', arguments: {} }], costPaise: 2 }
    return { content: 'Nothing more to do for now.', toolCalls: [], costPaise: 2 }
  }

  beforeAll(async () => {
    const url = requireTestDb()
    const cpUrl = process.env.CONTROL_PLANE_DATABASE_URL
    if (cpUrl && new URL(cpUrl).pathname.replace(/^\//, '') !== 'jeffi_test') throw new Error('CONTROL_PLANE_DATABASE_URL must be jeffi_test for this test')
    process.env.CONTROL_PLANE_DATABASE_URL = url
    process.env.OUTREACH_TEST_MODE = '1'
    process.env.VOICE_SERVICE_URL = 'http://voice.invalid:8080'
    h.placeCall.mockImplementation(async (i: { callId: string }) => ({ providerCallId: `p-${i.callId.slice(0, 8)}`, duplicate: false }))
    cp = (await import('@/lib/tenant-registry')).controlPlanePool()
    systemOwnerExisted = !!(await cp.query(`SELECT 1 FROM owners WHERE lower(email) = lower($1)`, [(await import('@/lib/auth/system-owners')).outreachSystemEmail()])).rowCount
    runtime = await import('@controller/lib/outreach/agent/runtime')
    modelMod = await import('@controller/lib/outreach/agent/model')
    store = await import('@controller/lib/outreach/agent/skill/store')
    builtin = await import('@controller/lib/outreach/agent/skill/builtin')
    worker = await import('@controller/lib/outreach/worker')
    toolsMod = await import('@controller/lib/outreach/tools')
    events = await import('@controller/lib/outreach/call-events')
    inbound = await import('@controller/lib/outreach/inbound')
    wa = await import('@controller/lib/outreach/whatsapp')
    prompt = await import('@controller/lib/outreach/prompt')

    // The program must be dialable for the scheduler; restored in afterAll.
    const ps = await (await import('@controller/lib/outreach/program-state')).getProgramState('showcase-offer')
    programBefore = { enabled: ps.enabled, daily_cap: ps.daily_cap, concurrency: ps.concurrency }
    await cp.query(`UPDATE outreach_program_state SET enabled = true, daily_cap = 100000, concurrency = 100000 WHERE program = 'showcase-offer'`)
    // The scheduler claims every due task: park leftovers of earlier test runs so only this test's tasks run.
    await cp.query(`UPDATE outreach_agent_tasks SET status = 'cancelled' WHERE status = 'pending' AND contact_id IN (SELECT id FROM outreach_contacts WHERE source = 'apitest')`)

    const two = builtin.BUILTIN_SKILLS.find(b => b.slug === 'showcase-two-call')!
    const created = await store.createSkill({
      tenantId: null,
      program: 'showcase-offer',
      content: two.content.replace('name: showcase-two-call', `name: ${SKILL_NAME(suffix)}`),
      actor: { id: null, label: 'apitest' },
    })
    expect(created.validation.ok, JSON.stringify(created.validation.issues)).toBe(true)
    skillId = created.skill.id
    skillSlug = created.skill.slug
    await cp.query(`INSERT INTO outreach_lists (id, program, name, source, skill_id) VALUES ($1, 'showcase-offer', $2, 'upload', $3)`, [listId, `Apitest list ${suffix}`, skillId])
    await cp.query(
      `INSERT INTO outreach_contacts (id, list_id, program, phone, business_name, owner_name, category, city, language, source, status, dnd_status)
       VALUES ($1, $2, 'showcase-offer', $3, $4, 'Asha', 'Bakery', 'Pune', 'en', 'apitest', 'queued', 'clear')`,
      [contactId, listId, phone, business]
    )
    await cp.query(`INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1, $2, 'Apitest Outreach Agent', 'active', '{showcase}'::text[])`, [tenantId, `apitest-agent-${suffix}`])
    modelMod.setAgentModel(scripted)
  }, 60_000)

  afterAll(async () => {
    modelMod?.setAgentModel(null)
    if (!cp) return
    if (siteId) {
      await cp.query(`DELETE FROM showcase_preview_tokens WHERE site_id = $1`, [siteId]).catch(() => {})
      await cp.query(`DELETE FROM site_studio_sessions WHERE site_id = $1`, [siteId]).catch(() => {})
    }
    // Contacts cascade their calls, messages, events, runs and tasks.
    await cp.query(`DELETE FROM outreach_contacts WHERE id = $1`, [contactId]).catch(() => {})
    await cp.query(`DELETE FROM outreach_lists WHERE id = $1`, [listId]).catch(() => {})
    if (skillId) await cp.query(`DELETE FROM outreach_skills WHERE id = $1`, [skillId]).catch(() => {})
    if (siteId) {
      const owner = (await cp.query(`SELECT owner_id FROM showcase_sites WHERE id = $1`, [siteId]).catch(() => ({ rows: [] }))).rows[0]?.owner_id
      await cp.query(`DELETE FROM showcase_sites WHERE id = $1`, [siteId]).catch(() => {})
      if (!systemOwnerExisted && owner) await cp.query(`DELETE FROM owners WHERE id = $1`, [owner]).catch(() => {})
    }
    await cp.query(`DELETE FROM billing_lines WHERE tenant_id = $1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => {})
    if (programBefore) {
      await cp.query(`UPDATE outreach_program_state SET enabled = $1, daily_cap = $2, concurrency = $3 WHERE program = 'showcase-offer'`, [programBefore.enabled, programBefore.daily_cap, programBefore.concurrency]).catch(() => {})
    }
    await endPool()
  })

  it('call 1: the run pins the uploaded skill; consent, preview, details and a callback booked; the call ends with a follow-up queued', async () => {
    const dialed = await worker.dialContact(await contact(), { language: 'en', actor: 'worker', from: '+911400000000', provider: 'exotel', test: false })
    call1 = dialed.callId
    expect((await contact()).status).toBe('calling')

    // voice-service starts: the session
    const session = (await runtime.buildVoiceSession(call1))!
    expect(session.skillRef).toBe(`${skillSlug}@v1`)
    expect(session.scriptVersion).toBe(`${skillSlug}@v1`)
    expect(session.systemPrompt).toContain('FIRST CALL (you have not spoken before)')
    expect(session.systemPrompt).toContain(business)
    expect(session.tools.map(t => t.name)).toEqual(expect.arrayContaining(['recordConsent', 'startPreview', 'addDetails', 'scheduleCallback', 'optOut', 'handOff']))
    expect(session.greeting).toBe(prompt.LINES.en.greeting(session.persona.name, { business, owner: 'Asha' }))
    const run = (await cp.query(`SELECT * FROM outreach_agent_runs WHERE contact_id = $1`, [contactId])).rows
    expect(run).toHaveLength(1)
    expect(run[0]).toMatchObject({ skill_ref: `${skillSlug}@v1`, status: 'active' })
    expect(run[0].skill_version_id).toBeTruthy()

    await events.handleCallEvent(call1, { type: 'ringing', data: { provider: 'exotel', providerCallId: 'p1' } })
    await events.handleCallEvent(call1, { type: 'answered' })

    const consent = await tool(call1, 'recordConsent', { whatsapp: true, recording_ack: true, quote: 'yes, send it on WhatsApp' })
    expect(consent.body.ok).toBe(true)
    const started = await tool(call1, 'startPreview', { business_name: business })
    expect(started.body).toMatchObject({ ok: true })
    const details = await tool(call1, 'addDetails', { what_they_do: 'Eggless cakes and fresh bread, baked every morning', hours: 'Tue-Sun 8am-9pm' })
    expect(details.body.ok).toBe(true)
    const booked = await tool(call1, 'scheduleCallback', { when: callbackAt.toISOString() })
    expect(booked.body).toMatchObject({ ok: true, end: true })

    await events.handleCallEvent(call1, { type: 'ended', data: { durationS: 140 } })

    const c = await contact()
    siteId = c.showcase_site_id
    expect(c.consent_whatsapp_at).toBeTruthy()
    expect(c.consent_evidence).toMatchObject({ whatsapp: true, scriptVersion: `${skillSlug}@v1`, callId: call1 })
    // an engaged contact keeps its status when the call ends
    expect(c.status).toBe('preview_sent')
    expect((await cp.query(`SELECT outcome, status FROM outreach_calls WHERE id = $1`, [call1])).rows[0]).toMatchObject({ outcome: 'interested', status: 'completed' })

    const captured = await wa.readCapturedWhatsApp({ contactId })
    expect(captured.map(m => m.template)).toEqual(['preview_ready'])
    expect(captured[0].buttonUrl).toBeTruthy()

    const t = await tasks()
    const callTask = t.find((x: any) => x.kind === 'call')
    expect(callTask).toMatchObject({ status: 'pending', reason: 'callback' })
    expect(new Date(callTask.due_at).getTime()).toBe(callbackAt.getTime())
    // the two-call skill has a Follow-up section, so the end of the call queued a turn
    expect(t.find((x: any) => x.kind === 'whatsapp_turn')).toMatchObject({ status: 'pending', reason: 'call_ended', instruction: `callId=${call1}` })
    expect((await eventsOf('tool_call')).map((e: any) => e.data.tool)).toEqual(['recordConsent', 'startPreview', 'addDetails', 'scheduleCallback'])
  }, 120_000)

  it('WhatsApp: the message goes to the agent, which saves the details through addDetails and replies in the window', async () => {
    const msg = { from: phone, text: 'We are at MG Road, open Tuesday to Sunday 8 to 9', providerMessageId: `wamid.apitest.${suffix}`, receivedAt: new Date() }
    const r = await inbound.handleOutreachInbound(await contact(), msg)
    expect(r).toEqual({ action: 'replied', reply: 'Thanks! I have added your address and hours.', tools: ['addDetails'] })

    const out = (await wa.readCapturedWhatsApp({ contactId })).filter(m => m.kind === 'text')
    expect(out.map(m => m.body)).toEqual(['Thanks! I have added your address and hours.'])
    const brief = (await contact()).extra.brief
    expect(brief).toMatchObject({ address: 'MG Road, Pune', hours: 'Tue-Sun 8am-9pm' })
    const waTools = (await eventsOf('tool_call')).filter((e: any) => e.data.channel === 'whatsapp')
    expect(waTools.map((e: any) => [e.data.tool, e.data.ok, e.actor])).toEqual([['addDetails', true, 'outreach:whatsapp']])
    expect((await eventsOf('agent_turn')).filter((e: any) => e.data.channel === 'whatsapp').map((e: any) => e.data.costPaise)).toEqual([2, 3])
    // a duplicate delivery of the same message is ignored
    expect(await inbound.handleOutreachInbound(await contact(), msg)).toEqual({ action: 'duplicate' })
  }, 120_000)

  it('scheduler: the follow-up turn runs, then the agent rings the engaged contact without moving its status', async () => {
    const before = await contact()
    const sum = await runtime.runDueAgentTasks(later, 10)
    expect(sum.claimed).toBeGreaterThanOrEqual(2)
    expect(sum.failed).toBe(0)

    const t = await tasks()
    const turn = t.find((x: any) => x.kind === 'whatsapp_turn' && x.reason === 'call_ended')
    expect(turn).toMatchObject({ status: 'done', result: { action: 'no_reply', tools: ['getSiteStatus'] } })
    // nothing the follow-up writes is sent
    expect((await wa.readCapturedWhatsApp({ contactId })).filter(m => m.kind === 'text')).toHaveLength(1)
    const followTurns = (await eventsOf('agent_turn')).filter((e: any) => e.data.channel === 'follow_up')
    expect(followTurns).toHaveLength(2)

    const call = t.find((x: any) => x.kind === 'call')
    expect(call.status).toBe('done')
    call2 = call.result.callId
    const row = (await cp.query(`SELECT * FROM outreach_calls WHERE id = $1`, [call2])).rows[0]
    expect(row).toMatchObject({ contact_id: contactId, status: 'queued', provider: 'exotel' })
    expect(h.placeCall).toHaveBeenLastCalledWith(expect.objectContaining({ callId: call2, to: phone }))
    const agentCalls = await eventsOf('agent_call')
    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0]).toMatchObject({ call_id: call2, actor: 'outreach:agent' })
    expect(agentCalls[0].data).toMatchObject({ taskId: call.id })

    const after = await contact()
    expect(after.status).toBe(before.status)
    expect(after.attempts).toBe(before.attempts)
    expect(after.last_call_id).toBe(call2)
  }, 120_000)

  it('call 2: continues the conversation; the publish is refused until the site is designed, then goes live with both links captured', async () => {
    const session = (await runtime.buildVoiceSession(call2, later))!
    expect(session.skillRef).toBe(`${skillSlug}@v1`)
    expect(session.greeting).toBe(prompt.LINES.en.greetingAgain(session.persona.name))
    expect(session.systemPrompt).toContain('SECOND CALL')
    expect(session.systemPrompt).toContain('You have spoken with them before')
    expect(session.systemPrompt).toContain('Address: MG Road, Pune')

    await events.handleCallEvent(call2, { type: 'answered' }, later)
    const refused = await tool(call2, 'publishSite', {}, later)
    expect(refused.body.ok).toBe(false)
    const c = await contact()
    expect(c.status).toBe('preview_sent')
    expect(await eventsOf('published')).toHaveLength(0)

    // The generation (AI, mocked) finishes: the design is done and the site belongs to a tenant, as after a real build.
    await cp.query(`UPDATE outreach_contacts SET extra = jsonb_set(extra, '{build}', $2::jsonb) WHERE id = $1`, [contactId, JSON.stringify({ state: 'done', builds: 1, builtAt: new Date().toISOString() })])
    await cp.query(`UPDATE showcase_sites SET tenant_id = $2 WHERE id = $1`, [siteId, tenantId])
    const needs = await tool(call2, 'publishSite', {}, later)
    expect(needs.body).toMatchObject({ ok: false, say: prompt.LINES.en.needContact })
    expect((await tool(call2, 'addDetails', { contact: { email: `bakery-${suffix}@example.test` } }, later)).body.ok).toBe(true)
    const live = await tool(call2, 'publishSite', {}, later)
    expect(live.body).toEqual({ ok: true, say: prompt.LINES.en.published })
    expect((await contact()).status).toBe('published')
    expect(await eventsOf('published')).toHaveLength(1)
    const sent = (await wa.readCapturedWhatsApp({ contactId })).filter(m => m.kind === 'template').map(m => m.template)
    expect(sent).toEqual(['preview_ready', 'site_live', 'claim'])
    // the claim link never reaches an audit row
    const publishRow = (await eventsOf('tool_call')).find((e: any) => e.data.tool === 'publishSite' && e.data.ok)
    expect(JSON.stringify(publishRow)).not.toContain('/claim/')

    await events.handleCallEvent(call2, { type: 'ended', data: { durationS: 90 } }, later)
    expect((await contact()).status).toBe('published')
    expect((await cp.query(`SELECT status, outcome FROM outreach_calls WHERE id = $1`, [call2])).rows[0]).toMatchObject({ status: 'completed', outcome: 'published' })
    // one run for the whole conversation, still active
    expect((await cp.query(`SELECT status, turns FROM outreach_agent_runs WHERE contact_id = $1`, [contactId])).rows).toEqual([{ status: 'active', turns: 4 }])
  }, 120_000)
})

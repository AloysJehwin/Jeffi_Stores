// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  event: vi.fn(),
  getProgramState: vi.fn(),
  loadCallContext: vi.fn(),
  readVoiceSettings: vi.fn(),
  knownBrief: vi.fn(),
  hadAnsweredCall: vi.fn(),
  transition: vi.fn(),
  isSuppressed: vi.fn(),
  sendText: vi.fn(),
  callCounts: vi.fn(),
  place: vi.fn(),
  getOpenRun: vi.fn(),
  createRun: vi.fn(),
  recordTurn: vi.fn(),
  handOff: vi.fn(),
  scheduleTask: vi.fn(),
  claimDueTasks: vi.fn(),
  finishTask: vi.fn(),
  invoke: vi.fn(),
  turnBudget: vi.fn(),
  agentCallQuota: vi.fn(),
  resolveSkill: vi.fn(),
  loadRunSkill: vi.fn(),
}))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/events', () => ({ recordEvent: h.event }))
vi.mock('@controller/lib/outreach/program-state', () => ({ getProgramState: h.getProgramState, WINDOW_MIN: '09:30', WINDOW_MAX: '20:30' }))
vi.mock('@controller/lib/outreach/session', () => ({
  loadCallContext: h.loadCallContext,
  readVoiceSettings: h.readVoiceSettings,
  knownBrief: h.knownBrief,
  hadAnsweredCall: h.hadAnsweredCall,
  MAX_DURATION_S: 720,
  SILENCE_S: 14,
}))
vi.mock('@controller/lib/outreach/state', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/state')>()), transition: h.transition }))
vi.mock('@controller/lib/outreach/suppress', () => ({ isSuppressed: h.isSuppressed }))
vi.mock('@controller/lib/outreach/whatsapp', () => ({ sendOutreachText: h.sendText, sendOutreachTemplate: vi.fn(), windowOpen: () => true }))
vi.mock('@controller/lib/outreach/worker', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/worker')>()), callCounts: h.callCounts, place: h.place }))
vi.mock('@controller/lib/outreach/build', () => ({ OutreachBuildError: class extends Error {} }))
vi.mock('@controller/lib/outreach/claim', () => ({ createClaimToken: vi.fn() }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/runs', () => ({
  getOpenRun: h.getOpenRun,
  createRun: h.createRun,
  recordTurn: h.recordTurn,
  handOff: h.handOff,
  scheduleTask: h.scheduleTask,
  claimDueTasks: h.claimDueTasks,
  finishTask: h.finishTask,
  pendingTaskCount: vi.fn(),
}))
vi.mock('@controller/lib/outreach/agent/invoke', () => ({ invokeTool: h.invoke }))
vi.mock('@controller/lib/outreach/agent/guards', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/agent/guards')>()), turnBudget: h.turnBudget, agentCallQuota: h.agentCallQuota }))
vi.mock('@controller/lib/outreach/agent/skill/store', async orig => ({
  ...(await orig<typeof import('@controller/lib/outreach/agent/skill/store')>()),
  resolveSkillForContact: h.resolveSkill,
  loadRunSkill: h.loadRunSkill,
}))

import {
  buildVoiceSession,
  dialAgentCall,
  ensureRun,
  onCallEnded,
  planFirstTouch,
  runAgentTurn,
  runDueAgentTasks,
  voiceAgentContext,
} from '@controller/lib/outreach/agent/runtime'
import { setAgentModel } from '@controller/lib/outreach/agent/model'
import { builtinSkill } from '@controller/lib/outreach/agent/skill/store'
import { OPT_OUT_CONFIRMATION } from '@controller/lib/outreach/agent/wa-lines'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'
import { InvalidTransitionError } from '@controller/lib/outreach/state'
import { VoiceServiceError } from '@controller/lib/outreach/voice-client'
import { LINES, SCRIPT_VERSION } from '@controller/lib/outreach/prompt'
import type { AgentModelReply, AgentModelRequest } from '@controller/lib/outreach/agent/types'

const NOW = new Date('2026-11-27T06:00:00Z') // 11:30 IST
const CALL = '11111111-1111-4111-8111-111111111111'
const DEFAULT = builtinSkill()
const TWO_CALL = builtinSkill('showcase-two-call')
const WA_ONLY = builtinSkill('showcase-whatsapp-only')

const runRow = (o: Record<string, unknown> = {}) => ({ id: 'r1', contact_id: 'k1', skill_version_id: null, skill_ref: DEFAULT.ref, status: 'active', turns: 0, spend_paise: 0, ...o })
const contactRow = (o: Record<string, unknown> = {}) => ({
  id: 'k1', list_id: null, program: 'showcase-offer', phone: '+919876543210', business_name: 'Ravi Silks', owner_name: 'Ravi', category: 'Sarees', city: 'Chennai',
  language: 'en', status: 'preview_sent', attempts: 1, dnd_status: 'clear', consent_whatsapp_at: '2026-11-26T05:00:00Z', showcase_site_id: 's1', opted_out_at: null,
  handoff_at: null, handoff_reason: null, wa_window_expires_at: '2026-11-28T05:00:00Z', ...o,
})
const state = (o: Record<string, unknown> = {}) => ({ program: 'showcase-offer', enabled: true, daily_cap: 50, concurrency: 2, window_start: '09:30', window_end: '20:30', test_numbers: [], ...o })
const task = (o: Record<string, unknown> = {}) => ({ id: 't1', run_id: 'r1', contact_id: 'k1', kind: 'whatsapp_turn', due_at: NOW.toISOString(), reason: null, instruction: null, status: 'running', attempts: 1, ...o }) as any

let contacts: Record<string, Record<string, unknown>>
let messages: { direction: string; body: string }[]
let callRow: Record<string, unknown> | null
let agentCallEvent: boolean
let liveCall: boolean
let openRun: Record<string, unknown> | null
let skill = DEFAULT

const reply = (content: string, toolCalls: AgentModelReply['toolCalls'] = [], costPaise = 3): AgentModelReply => ({ content, toolCalls, costPaise })
const script = (...replies: AgentModelReply[]) => {
  const calls: AgentModelRequest[] = []
  setAgentModel(async req => {
    calls.push(JSON.parse(JSON.stringify(req)))
    return replies[Math.min(calls.length - 1, replies.length - 1)]
  })
  return calls
}
const kinds = () => h.event.mock.calls.map(c => c[1])
const eventOf = (kind: string) => h.event.mock.calls.find(c => c[1] === kind)?.[2]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('VOICE_SERVICE_URL', 'http://voice:8080')
  contacts = { k1: contactRow() }
  messages = [{ direction: 'in', body: 'We open 9 to 9' }]
  callRow = null
  agentCallEvent = false
  liveCall = false
  openRun = runRow()
  skill = DEFAULT
  h.query.mockImplementation(async (sql: string, p: unknown[] = []) => {
    if (sql.startsWith('SELECT * FROM outreach_contacts WHERE id')) return { rows: contacts[p[0] as string] ? [contacts[p[0] as string]] : [] }
    if (sql.includes('FROM outreach_messages')) return { rows: [...messages].reverse() }
    if (sql.startsWith('SELECT id, contact_id, answered_at FROM outreach_calls') || sql.startsWith('SELECT id, status, outcome, summary FROM outreach_calls')) return { rows: callRow ? [callRow] : [] }
    if (sql.includes("kind = 'agent_call'")) return { rows: agentCallEvent ? [{}] : [] }
    if (sql.startsWith('SELECT 1 FROM outreach_calls WHERE contact_id')) return { rows: liveCall ? [{}] : [] }
    return { rows: [], rowCount: 1 }
  })
  h.getOpenRun.mockImplementation(async () => openRun)
  h.loadRunSkill.mockImplementation(async () => skill)
  h.resolveSkill.mockImplementation(async () => skill)
  h.createRun.mockImplementation(async (i: { skillRef: string }) => runRow({ skill_ref: i.skillRef }))
  h.getProgramState.mockResolvedValue(state())
  h.readVoiceSettings.mockResolvedValue({ provider: 'exotel', settings: { sarvam: { voices: { en: 'ishita', ta: 'kavya' } }, exotel: { callerId: '+911400000000' }, twilioTest: { from: '+15550001111' } } })
  h.knownBrief.mockResolvedValue({})
  h.hadAnsweredCall.mockResolvedValue(false)
  h.isSuppressed.mockResolvedValue(false)
  h.turnBudget.mockResolvedValue(null)
  h.agentCallQuota.mockResolvedValue(null)
  h.sendText.mockResolvedValue({ ok: true, mode: 'captured', messageId: 'm1', providerMessageId: null })
  h.invoke.mockResolvedValue({ status: 200, ok: true })
  h.callCounts.mockResolvedValue({ today: 0, active: 0 })
  h.place.mockResolvedValue({ callId: 'x', providerCallId: 'p1' })
  h.claimDueTasks.mockResolvedValue([])
  h.transition.mockResolvedValue({})
  h.scheduleTask.mockResolvedValue({ id: 'new' })
  h.event.mockResolvedValue(undefined)
  h.finishTask.mockResolvedValue(undefined)
  h.recordTurn.mockResolvedValue(undefined)
  h.handOff.mockResolvedValue(undefined)
  setAgentModel(null)
})
afterEach(() => {
  vi.unstubAllEnvs()
  setAgentModel(null)
})

describe('ensureRun', () => {
  it('reuses the open run and loads the skill it pinned', async () => {
    const r = await ensureRun(contactRow() as any, NOW)
    expect(r.run.id).toBe('r1')
    expect(r.skill).toBe(DEFAULT)
    expect(h.loadRunSkill).toHaveBeenCalledWith(openRun)
    expect(h.createRun).not.toHaveBeenCalled()
  })

  it('opens a run for a contact without one, pinning the resolved skill version', async () => {
    openRun = null
    skill = TWO_CALL
    const r = await ensureRun(contactRow({ list_id: 'l1' }) as any, NOW)
    expect(h.resolveSkill).toHaveBeenCalled()
    expect(h.createRun).toHaveBeenCalledWith({ contactId: 'k1', skillVersionId: null, skillRef: TWO_CALL.ref })
    expect(r.skill).toBe(TWO_CALL)
  })
})

describe('buildVoiceSession', () => {
  const callRowFor = (o: Record<string, unknown> = {}) => ({ id: CALL, contact_id: 'k1', language: 'ta', ended_at: null, ...o })

  it('for the builtin default gives today\'s nine tools plus handOff, the skill ref and the old session fields', async () => {
    openRun = null
    h.loadCallContext.mockResolvedValue({ call: callRowFor(), contact: contactRow({ language: 'ta', status: 'calling', consent_whatsapp_at: null, showcase_site_id: null }) })
    h.getProgramState.mockResolvedValue(state({ test_numbers: ['+919876543210'] }))
    const s = (await buildVoiceSession(CALL, NOW))!
    expect(s.skillRef).toBe('showcase-offer/2026-11-24.1')
    expect(s.scriptVersion).toBe(SCRIPT_VERSION)
    expect(s.tools.map(t => t.name).sort()).toEqual(['addDetails', 'handOff', 'markOutcome', 'optOut', 'publishSite', 'recordConsent', 'requestChange', 'scheduleCallback', 'startPreview', 'switchLanguage'])
    expect(s.tools.find(t => t.name === 'startPreview')!.input_schema).toBeTruthy()
    expect(s.language).toBe('ta')
    expect(s.persona).toEqual({ name: 'Kavya', voiceId: 'kavya' })
    expect(s.greeting).toBe(LINES.ta.greeting('Kavya', { business: 'Ravi Silks', owner: 'Ravi' }))
    expect(s.apology).toBe(LINES.ta.apologyCallBack)
    expect(s.maxDurationS).toBe(720)
    expect(s.silenceS).toBe(14)
    expect(s.testNumbers).toEqual(['+919876543210'])
    expect(s.systemPrompt).toContain('Ravi Silks')
    expect(s.systemPrompt).toContain('Tamil')
    expect(s.systemPrompt).toContain(LINES.ta.aiAnswer)
    expect(s.systemPrompt).toContain('Never claim to be human')
    expect(s.systemPrompt).toContain(`Script version: ${SCRIPT_VERSION}`)
    expect(h.createRun).toHaveBeenCalledWith({ contactId: 'k1', skillVersionId: null, skillRef: 'showcase-offer/2026-11-24.1' })
  })

  it('renders the skill the run pinned, with the skill\'s own text and tools', async () => {
    skill = TWO_CALL
    openRun = runRow({ skill_ref: TWO_CALL.ref })
    h.loadCallContext.mockResolvedValue({ call: callRowFor({ language: 'en' }), contact: contactRow({ language: 'en' }) })
    const s = (await buildVoiceSession(CALL, NOW))!
    expect(s.skillRef).toBe(TWO_CALL.ref)
    expect(s.systemPrompt).toContain('SECOND CALL')
    expect(s.tools.map(t => t.name)).toContain('getSiteStatus')
  })

  it('a follow-up call greets again, carries over what is known and promises WhatsApp only with consent', async () => {
    h.loadCallContext.mockResolvedValue({ call: callRowFor(), contact: contactRow({ language: 'ta', consent_whatsapp_at: '2026-11-26T05:00:00Z' }) })
    h.hadAnsweredCall.mockResolvedValue(true)
    h.knownBrief.mockResolvedValue({ whatTheyDo: 'silk sarees', highlights: ['handloom'] })
    const s = (await buildVoiceSession(CALL, NOW))!
    expect(s.greeting).toBe(LINES.ta.greetingAgain('Kavya'))
    expect(s.apology).toBe(LINES.ta.apologyWhatsApp)
    expect(s.systemPrompt).toContain('What they do: silk sarees')
    expect(h.hadAnsweredCall).toHaveBeenCalledWith('k1', CALL)
  })

  it('falls back to English and no test numbers; null for an unknown call', async () => {
    h.loadCallContext.mockResolvedValue({ call: callRowFor({ language: null }), contact: contactRow({ language: 'xx' }) })
    h.getProgramState.mockRejectedValue(new Error('unknown program'))
    h.readVoiceSettings.mockResolvedValue({ provider: 'exotel', settings: { sarvam: { voices: {} } } })
    const s = (await buildVoiceSession(CALL, NOW))!
    expect([s.language, s.testNumbers, s.persona.voiceId]).toEqual(['en', [], ''])
    h.loadCallContext.mockResolvedValue(null)
    expect(await buildVoiceSession(CALL, NOW)).toBeNull()
  })
})

describe('voiceAgentContext', () => {
  it('always carries a run, the skill\'s limits (never above the hard ones) and the skill language', async () => {
    skill = TWO_CALL
    openRun = runRow({ skill_ref: TWO_CALL.ref })
    h.loadCallContext.mockResolvedValue({ call: { id: CALL, contact_id: 'k1', language: 'hi' }, contact: contactRow() })
    const c = (await voiceAgentContext(CALL, NOW))!
    expect(c.run.id).toBe('r1')
    expect(c.limits.maxAgentCalls).toBe(2)
    expect(c.limits.maxTurnsPerDay).toBe(HARD_LIMITS.maxTurnsPerDay)
    expect(c.language).toBe('hi')
    h.loadCallContext.mockResolvedValue(null)
    expect(await voiceAgentContext(CALL, NOW)).toBeNull()
  })
})

describe('runAgentTurn: WhatsApp', () => {
  const turn = (over: Record<string, unknown> = {}) =>
    runAgentTurn({ contact: contacts.k1 as any, channel: 'whatsapp', trigger: { kind: 'inbound', messageId: 'm9' }, language: 'en', now: NOW, ...over } as any)

  it('lets the model save details through addDetails, then sends its reply as free text', async () => {
    h.invoke.mockResolvedValue({ status: 200, ok: true, data: { building: false, missing: ['address'] } })
    const calls = script(reply('', [{ id: 't1', name: 'addDetails', arguments: { hours: '9 to 9' } }], 4), reply('Got it! Where is your shop?', [], 6))
    const r = await turn()
    expect(r).toEqual({ action: 'replied', reply: 'Got it! Where is your shop?', tools: ['addDetails'] })
    expect(h.sendText).toHaveBeenCalledWith('k1', 'Got it! Where is your shop?', { actor: 'outreach:whatsapp' }, NOW)

    expect(h.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp', actor: 'outreach:whatsapp', call: null, language: 'en', now: NOW, scriptVersion: DEFAULT.ref, name: 'addDetails', args: { hours: '9 to 9' },
        allowed: DEFAULT.skill.meta.tools.whatsapp, run: expect.objectContaining({ id: 'r1' }), contact: expect.objectContaining({ id: 'k1' }), limits: HARD_LIMITS,
      })
    )
    expect(calls).toHaveLength(2)
    expect(calls[0].system).toContain('Ravi Silks')
    expect(calls[0].channel).toBe('whatsapp')
    expect(calls[0].tools.map(t => t.name)).toEqual(expect.arrayContaining(['addDetails', 'requestChange', 'optOut', 'handOff']))
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'We open 9 to 9' }])
    expect(calls[1].messages.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ id: 't1', name: 'addDetails', arguments: { hours: '9 to 9' } }] })
    expect(calls[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 't1', content: JSON.stringify({ ok: true, building: false, missing: ['address'] }) })
    // one agent_turn event and one run turn per model call, with its cost
    expect(h.event.mock.calls.filter(c => c[1] === 'agent_turn').map(c => c[2])).toEqual([
      { actor: 'outreach:whatsapp', data: { runId: 'r1', channel: 'whatsapp', costPaise: 4 } },
      { actor: 'outreach:whatsapp', data: { runId: 'r1', channel: 'whatsapp', costPaise: 6 } },
    ])
    expect(h.recordTurn.mock.calls).toEqual([['r1', 'whatsapp', 4, NOW], ['r1', 'whatsapp', 6, NOW]])
  })

  it('passes a refused tool back to the model with its error', async () => {
    h.invoke.mockResolvedValue({ status: 403, ok: false, error: 'not_allowed' })
    const calls = script(reply('', [{ id: '', name: 'publishSite', arguments: {} }]), reply('Our team will help with that.'))
    expect(await turn()).toMatchObject({ action: 'replied', tools: ['publishSite'] })
    expect(calls[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_0_0', content: JSON.stringify({ ok: false, error: 'not_allowed' }) })
  })

  it('offers tools on all but the last of four model calls and stops there', async () => {
    const calls = script(reply('', [{ id: 'a', name: 'getLead', arguments: {} }]))
    h.invoke.mockResolvedValue({ status: 200, ok: true, data: {} })
    const r = await turn()
    expect(calls).toHaveLength(4)
    expect(calls.map(c => c.tools.length > 0)).toEqual([true, true, true, false])
    expect(r).toMatchObject({ action: 'no_reply', tools: ['getLead', 'getLead', 'getLead'] })
  })

  it('an optOut through the tool sends the one confirmation and stops', async () => {
    h.invoke.mockResolvedValue({ status: 200, ok: true, data: { optedOut: true } })
    const calls = script(reply('', [{ id: 't1', name: 'optOut', arguments: {} }]))
    const r = await turn({ language: 'hi' })
    expect(r).toEqual({ action: 'opted_out', tools: ['optOut'], confirmed: true })
    expect(h.sendText).toHaveBeenCalledTimes(1)
    expect(h.sendText).toHaveBeenCalledWith('k1', OPT_OUT_CONFIRMATION.hi, { actor: 'outreach:whatsapp', optOutConfirmation: true }, NOW)
    expect(calls).toHaveLength(1)
  })

  it('a handed-off run is paused: nothing is sent and the model is not called', async () => {
    openRun = runRow({ status: 'handed_off' })
    const calls = script(reply('hi'))
    expect(await turn()).toEqual({ action: 'paused', tools: [] })
    expect(kinds()).toContain('agent_paused')
    expect(calls).toHaveLength(0)
    expect(h.sendText).not.toHaveBeenCalled()
  })

  it('an opted-out or suppressed contact gets nothing', async () => {
    const calls = script(reply('hi'))
    expect(await turn({ contact: contactRow({ opted_out_at: '2026-11-26T00:00:00Z' }) })).toMatchObject({ action: 'opted_out', tools: [] })
    h.isSuppressed.mockResolvedValue(true)
    expect(await turn()).toMatchObject({ action: 'opted_out' })
    expect(calls).toHaveLength(0)
    expect(h.sendText).not.toHaveBeenCalled()
  })

  it('a budget refusal hands the lead off with the code as the reason and sends the honest fallback line', async () => {
    h.turnBudget.mockResolvedValue('turn_limit')
    const calls = script(reply('hi'))
    expect(await turn()).toEqual({ action: 'budget', tools: [] })
    expect(h.handOff).toHaveBeenCalledWith({ contactId: 'k1', reason: 'turn_limit', channel: 'whatsapp', actor: 'outreach:whatsapp', now: NOW })
    expect(h.sendText.mock.calls[0][1]).toContain('Our team will get back to you')
    expect(calls).toHaveLength(0)
  })

  it('a skill without a WhatsApp section hands off with the fallback line', async () => {
    skill = { ...DEFAULT, skill: { ...DEFAULT.skill, sections: { voice: 'x' } } }
    const calls = script(reply('hi'))
    expect(await turn()).toMatchObject({ action: 'budget' })
    expect(h.handOff).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no_whatsapp_section' }))
    expect(h.sendText).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(0)
  })

  it('replaces a reply that denies being an AI with the honest line and records it', async () => {
    script(reply("No, I'm a real person, don't worry."))
    const r = await turn()
    expect(r).toMatchObject({ action: 'replied', reply: LINES.en.aiAnswer })
    expect(h.sendText.mock.calls[0][1]).toBe(LINES.en.aiAnswer)
    expect(kinds()).toContain('ai_denial_blocked')
  })

  it('answers in the contact language: the fallback line after a model error', async () => {
    setAgentModel(async () => {
      throw new Error('gateway down')
    })
    const r = await turn({ language: 'hi' })
    expect(r).toMatchObject({ action: 'fallback' })
    expect(h.sendText.mock.calls[0][1]).toContain('धन्यवाद')
    expect(eventOf('whatsapp_assistant_failed')).toMatchObject({ data: { error: 'gateway down' } })
  })

  it('sends nothing for an empty reply', async () => {
    script(reply('   '))
    expect(await turn()).toEqual({ action: 'no_reply', tools: [] })
    expect(h.sendText).not.toHaveBeenCalled()
  })
})

describe('runAgentTurn: follow_up', () => {
  const follow = (trigger: unknown, over: Record<string, unknown> = {}) =>
    runAgentTurn({ contact: contacts.k1 as any, channel: 'follow_up', trigger: trigger as any, language: 'en', now: NOW, ...over } as any)
  const FU = { kind: 'follow_up', taskId: 't1', reason: 'nudge', instruction: 'send the preview link once' }

  beforeEach(() => {
    skill = TWO_CALL
    openRun = runRow({ skill_ref: TWO_CALL.ref })
  })

  it('never sends what the model writes: it only records a short excerpt', async () => {
    const calls = script(reply('I will wait until tomorrow.'))
    const r = await follow(FU, { contact: contactRow({ wa_window_expires_at: '2026-11-28T05:00:00Z' }) })
    expect(r).toEqual({ action: 'no_reply', tools: [] })
    expect(h.sendText).not.toHaveBeenCalled()
    expect(eventOf('agent_follow_up')).toMatchObject({ actor: 'outreach:agent', data: { excerpt: 'I will wait until tomorrow.' } })
    expect(calls[0].channel).toBe('follow_up')
    // the trigger is described to the model as a user message that asks for a decision through tools
    const last = calls[0].messages.at(-1)!
    expect(last.role).toBe('user')
    expect(last.content).toContain('send the preview link once')
    expect(last.content).toContain('through tools')
    expect(calls[0].system).toContain('nothing you write is sent')
  })

  it('runs its tools as outreach:agent and reports them', async () => {
    h.invoke.mockResolvedValue({ status: 200, ok: true, data: { sent: true } })
    script(reply('', [{ id: 'f1', name: 'sendWhatsAppTemplate', arguments: { template: 'preview_ready' } }]), reply(''))
    const r = await follow(FU)
    expect(r).toEqual({ action: 'no_reply', tools: ['sendWhatsAppTemplate'] })
    expect(h.invoke).toHaveBeenCalledWith(expect.objectContaining({ channel: 'follow_up', actor: 'outreach:agent', allowed: TWO_CALL.skill.meta.tools.follow_up }))
    expect(h.sendText).not.toHaveBeenCalled()
  })

  it('joins the trigger to a last user message, and describes a call that just ended', async () => {
    messages = [{ direction: 'out', body: 'Here is your preview' }, { direction: 'in', body: 'ok' }]
    const calls = script(reply(''))
    await follow({ kind: 'call_ended', callId: CALL, outcome: 'interested', summary: 'Wants changes' })
    const msgs = calls[0].messages
    expect(msgs.map(m => m.role)).toEqual(['user'])
    expect(msgs[0].content).toContain('ok')
    expect(msgs[0].content).toContain('outcome interested')
    expect(msgs[0].content).toContain('Wants changes')
  })

  it('a skill without a Follow-up section takes no follow-up turn', async () => {
    skill = DEFAULT
    openRun = runRow()
    const calls = script(reply('x'))
    expect(await follow(FU)).toEqual({ action: 'no_reply', tools: [] })
    expect(calls).toHaveLength(0)
  })

  it('a budget refusal hands off quietly (nothing is sent on a follow-up)', async () => {
    h.turnBudget.mockResolvedValue('spend_limit')
    expect(await follow(FU)).toEqual({ action: 'budget', tools: [] })
    expect(h.handOff).toHaveBeenCalledWith(expect.objectContaining({ reason: 'spend_limit', channel: 'follow_up', actor: 'outreach:agent' }))
    expect(h.sendText).not.toHaveBeenCalled()
  })

  it('a model error is a fallback without a message', async () => {
    setAgentModel(async () => {
      throw new Error('down')
    })
    expect(await follow(FU)).toEqual({ action: 'fallback', tools: [] })
    expect(h.sendText).not.toHaveBeenCalled()
    expect(kinds()).toContain('whatsapp_assistant_failed')
  })
})

describe('onCallEnded', () => {
  beforeEach(() => {
    skill = TWO_CALL
    openRun = runRow({ skill_ref: TWO_CALL.ref })
    callRow = { id: CALL, contact_id: 'k1', answered_at: '2026-11-27T05:50:00Z' }
  })

  it('schedules a call_ended follow-up now when the skill has a Follow-up section', async () => {
    await onCallEnded(CALL, 'ended', NOW)
    expect(h.scheduleTask).toHaveBeenCalledWith({ runId: 'r1', contactId: 'k1', kind: 'whatsapp_turn', dueAt: NOW, reason: 'call_ended', instruction: `callId=${CALL}`, createdBy: 'outreach:agent' })
  })

  it('does nothing for a skill without a Follow-up section (the default)', async () => {
    skill = DEFAULT
    await onCallEnded(CALL, 'ended', NOW)
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })

  it('an unanswered agent call wakes the agent; an unanswered dialler call does not', async () => {
    callRow = { id: CALL, contact_id: 'k1', answered_at: null }
    await onCallEnded(CALL, 'no_answer', NOW)
    expect(h.scheduleTask).not.toHaveBeenCalled()
    agentCallEvent = true
    await onCallEnded(CALL, 'voicemail', NOW)
    expect(h.scheduleTask).toHaveBeenCalledWith(expect.objectContaining({ reason: 'call_unanswered', instruction: `callId=${CALL}` }))
    h.scheduleTask.mockClear()
    await onCallEnded(CALL, 'error', NOW)
    expect(h.scheduleTask).toHaveBeenCalledTimes(1)
  })

  it('an answered call that errored, or an unanswered one that "ended", schedules nothing', async () => {
    await onCallEnded(CALL, 'error', NOW)
    callRow = { id: CALL, contact_id: 'k1', answered_at: null }
    agentCallEvent = true
    await onCallEnded(CALL, 'ended', NOW)
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })

  it.each([
    ['not engaged yet', { status: 'calling' }],
    ['claimed', { status: 'claimed' }],
    ['opted out', { opted_out_at: '2026-11-27T05:55:00Z' }],
    ['handed off', { handoff_at: '2026-11-27T05:55:00Z' }],
  ])('skips a contact that is %s', async (_n, over) => {
    contacts.k1 = contactRow(over)
    await onCallEnded(CALL, 'ended', NOW)
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })

  it('skips a suppressed number and a run that is not active', async () => {
    h.isSuppressed.mockResolvedValue(true)
    await onCallEnded(CALL, 'ended', NOW)
    h.isSuppressed.mockResolvedValue(false)
    openRun = runRow({ status: 'handed_off' })
    await onCallEnded(CALL, 'ended', NOW)
    openRun = null
    await onCallEnded(CALL, 'ended', NOW)
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })

  it('never throws into the events route', async () => {
    h.query.mockRejectedValue(new Error('db down'))
    await expect(onCallEnded(CALL, 'ended', NOW)).resolves.toBeUndefined()
  })
})

describe('dialAgentCall', () => {
  const dial = (over: Record<string, unknown> = {}, at = NOW) => dialAgentCall(contactRow(over) as any, task({ id: 't9', kind: 'call' }), at)
  const insertedCall = () => h.query.mock.calls.find(c => String(c[0]).startsWith('INSERT INTO outreach_calls'))

  it('rings an engaged contact: a call row, last_call_id, an agent_call event and no status move or attempt', async () => {
    const r = await dial()
    expect(r).toEqual({ callId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    const id = (r as { callId: string }).callId
    expect(insertedCall()![1]).toEqual([id, 'k1', 'exotel', 'en'])
    expect(h.query.mock.calls.some(c => String(c[0]).startsWith('UPDATE outreach_contacts SET last_call_id = $2') && c[1][1] === id)).toBe(true)
    expect(h.event).toHaveBeenCalledWith('k1', 'agent_call', { callId: id, actor: 'outreach:agent', data: { taskId: 't9', language: 'en' } })
    expect(h.place).toHaveBeenCalledWith(expect.objectContaining({ id: 'k1' }), id, { language: 'en', actor: 'outreach:agent', from: '+911400000000', provider: 'exotel', test: false }, false)
    expect(h.transition).not.toHaveBeenCalled()
    expect(h.query.mock.calls.some(c => /attempts/.test(String(c[0])))).toBe(false)
  })

  it('waits for the next window when it is outside calling hours', async () => {
    const r = await dial({}, new Date('2026-11-27T16:30:00Z')) // 22:00 IST
    expect(r).toEqual({ reschedule: new Date('2026-11-28T04:00:00Z'), reason: 'outside_window' })
    expect(insertedCall()).toBeUndefined()
    expect(h.place).not.toHaveBeenCalled()
  })

  it('refuses DND and suppressed numbers', async () => {
    expect(await dial({ dnd_status: 'dnd' })).toEqual({ fail: 'dnd' })
    h.isSuppressed.mockResolvedValue(true)
    expect(await dial()).toEqual({ fail: 'suppressed' })
    expect(await dial({ status: 'suppressed' })).toEqual({ fail: 'suppressed' })
    expect(h.place).not.toHaveBeenCalled()
  })

  it('fails a disabled program, and in test mode a number that is not a test number', async () => {
    h.getProgramState.mockResolvedValueOnce(state({ enabled: false }))
    expect(await dial()).toEqual({ fail: 'program_disabled' })
    h.readVoiceSettings.mockResolvedValue({ provider: 'twilio_test', settings: { twilioTest: { from: '+15550001111' }, exotel: { callerId: '' } } })
    expect(await dial()).toEqual({ fail: 'not_test_number' })
    h.getProgramState.mockResolvedValue(state({ test_numbers: ['+919876543210'] }))
    expect(await dial()).toEqual({ callId: expect.any(String) })
    expect(h.place).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ from: '+15550001111', test: true }), false)
  })

  it('reschedules when voice is not configured, the program is at its cap or full, or a call is live', async () => {
    vi.stubEnv('VOICE_SERVICE_URL', '')
    expect(await dial()).toEqual({ reschedule: new Date(NOW.getTime() + 30 * 60_000), reason: 'voice_not_configured' })
    vi.stubEnv('VOICE_SERVICE_URL', 'http://voice:8080')
    h.callCounts.mockResolvedValueOnce({ today: 50, active: 0 })
    expect(await dial()).toEqual({ reschedule: new Date(NOW.getTime() + 10 * 60_000), reason: 'daily_cap' })
    h.callCounts.mockResolvedValueOnce({ today: 0, active: 2 })
    expect(await dial()).toEqual({ reschedule: new Date(NOW.getTime() + 10 * 60_000), reason: 'concurrency' })
    liveCall = true
    expect(await dial()).toEqual({ reschedule: new Date(NOW.getTime() + 10 * 60_000), reason: 'call_in_progress' })
    expect(h.place).not.toHaveBeenCalled()
  })

  it('fails over the agent call quota', async () => {
    h.agentCallQuota.mockResolvedValue('call_limit')
    expect(await dial()).toEqual({ fail: 'call_limit' })
    expect(h.agentCallQuota).toHaveBeenCalledWith('k1', expect.objectContaining({ maxAgentCalls: HARD_LIMITS.maxAgentCalls }), NOW)
  })

  it('a refused dial reschedules in 10 minutes; an unconfirmed one counts as placed', async () => {
    h.place.mockRejectedValueOnce(new VoiceServiceError('refused', 422))
    expect(await dial()).toEqual({ reschedule: new Date(NOW.getTime() + 10 * 60_000), reason: 'dial_failed' })
    h.place.mockRejectedValueOnce(new VoiceServiceError('unreachable', 0))
    expect(await dial()).toEqual({ callId: expect.any(String) })
  })
})

describe('runDueAgentTasks', () => {
  it('claims nothing, runs nothing', async () => {
    expect(await runDueAgentTasks(NOW)).toEqual({ claimed: 0, ran: 0, rescheduled: 0, failed: 0, cancelled: 0 })
    expect(h.claimDueTasks).toHaveBeenCalledWith(NOW, 10)
  })

  it('dispatches a call task to the dialler and a whatsapp_turn to a follow-up turn', async () => {
    skill = TWO_CALL
    openRun = runRow({ skill_ref: TWO_CALL.ref })
    callRow = { id: CALL, contact_id: 'k1', status: 'completed', outcome: 'interested', summary: 'Wants to publish' }
    h.claimDueTasks.mockResolvedValue([task({ id: 'tc', kind: 'call', reason: 'callback' }), task({ id: 'tw', kind: 'whatsapp_turn', reason: 'call_ended', instruction: `callId=${CALL}` })])
    const calls = script(reply(''))
    const sum = await runDueAgentTasks(NOW, 5)
    expect(sum).toEqual({ claimed: 2, ran: 2, rescheduled: 0, failed: 0, cancelled: 0 })
    expect(h.claimDueTasks).toHaveBeenCalledWith(NOW, 5)
    expect(h.finishTask).toHaveBeenCalledWith('tc', 'done', { callId: expect.any(String) })
    expect(h.finishTask).toHaveBeenCalledWith('tw', 'done', { action: 'no_reply', tools: [] })
    // the follow-up turn was told how the call went
    expect(calls[0].messages.at(-1)!.content).toContain('outcome interested')
    expect(calls[0].messages.at(-1)!.content).toContain('Wants to publish')
  })

  it('a plain follow-up task carries its reason and instruction as the trigger', async () => {
    skill = TWO_CALL
    openRun = runRow({ skill_ref: TWO_CALL.ref })
    h.claimDueTasks.mockResolvedValue([task({ reason: 'nudge', instruction: 'check the preview was seen' })])
    const calls = script(reply(''))
    await runDueAgentTasks(NOW)
    expect(calls[0].messages.at(-1)!.content).toContain('check the preview was seen')
  })

  it('cancels tasks of an opted-out, suppressed or handed-off contact, or without an active run', async () => {
    contacts = { k1: contactRow({ opted_out_at: '2026-11-27T05:00:00Z' }), k2: contactRow({ id: 'k2', handoff_at: '2026-11-27T05:00:00Z' }), k3: contactRow({ id: 'k3' }), k4: contactRow({ id: 'k4' }) }
    h.getOpenRun.mockImplementation(async (id: string) => (id === 'k3' ? runRow({ status: 'handed_off' }) : id === 'k4' ? null : openRun))
    h.claimDueTasks.mockResolvedValue([task({ id: 'a' }), task({ id: 'b', contact_id: 'k2' }), task({ id: 'c', contact_id: 'k3' }), task({ id: 'd', contact_id: 'k4' })])
    const calls = script(reply('x'))
    const sum = await runDueAgentTasks(NOW)
    expect(sum).toMatchObject({ claimed: 4, cancelled: 4, ran: 0 })
    expect(h.finishTask.mock.calls.map(c => c[1])).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled'])
    expect(calls).toHaveLength(0)
    expect(h.place).not.toHaveBeenCalled()
  })

  it('fails a task whose contact is gone', async () => {
    h.claimDueTasks.mockResolvedValue([task({ contact_id: 'gone' })])
    expect(await runDueAgentTasks(NOW)).toMatchObject({ failed: 1 })
    expect(h.finishTask).toHaveBeenCalledWith('t1', 'failed', { reason: 'no_contact' })
  })

  it('reschedules a call task the dialler defers, and fails one it refuses', async () => {
    h.claimDueTasks.mockResolvedValue([task({ id: 'x', kind: 'call' }), task({ id: 'y', kind: 'call' })])
    h.agentCallQuota.mockResolvedValueOnce(null).mockResolvedValueOnce('call_limit')
    liveCall = true
    const sum = await runDueAgentTasks(NOW)
    expect(sum).toMatchObject({ rescheduled: 1, failed: 1 })
    expect(h.finishTask).toHaveBeenCalledWith('x', 'pending', { reason: 'call_in_progress' }, new Date(NOW.getTime() + 10 * 60_000))
    expect(h.finishTask).toHaveBeenCalledWith('y', 'failed', { reason: 'call_limit' })
  })

  it('a thrown task is retried in 10 minutes until its third attempt, then failed', async () => {
    h.claimDueTasks.mockResolvedValue([task({ id: 'x', kind: 'call', attempts: 1 }), task({ id: 'y', kind: 'call', attempts: 3 })])
    h.getOpenRun.mockRejectedValue(new Error('db down'))
    const sum = await runDueAgentTasks(NOW)
    expect(sum).toMatchObject({ rescheduled: 1, failed: 1 })
    expect(h.finishTask).toHaveBeenCalledWith('x', 'pending', { error: 'db down' }, new Date(NOW.getTime() + 10 * 60_000))
    expect(h.finishTask).toHaveBeenCalledWith('y', 'failed', { error: 'db down' })
  })
})

describe('planFirstTouch', () => {
  it('rings a contact whose skill has a voice flow (the default)', async () => {
    expect(await planFirstTouch(contactRow({ status: 'queued' }) as any, NOW)).toBe('call')
    expect(h.transition).not.toHaveBeenCalled()
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })

  it('a WhatsApp-only skill with consent starts the contact at interested and kicks the agent off now', async () => {
    skill = WA_ONLY
    openRun = runRow({ skill_ref: WA_ONLY.ref })
    const c = contactRow({ status: 'queued' }) as any
    expect(await planFirstTouch(c, NOW)).toBe('whatsapp')
    expect(h.transition).toHaveBeenCalledWith(c, 'interested', expect.objectContaining({ actor: 'outreach:agent' }))
    expect(h.scheduleTask).toHaveBeenCalledWith({ runId: 'r1', contactId: 'k1', kind: 'whatsapp_turn', dueAt: NOW, reason: 'kickoff', createdBy: 'outreach:agent' })
  })

  it('without recorded consent it fails the lead (WhatsApp never goes first without it) and skips', async () => {
    skill = WA_ONLY
    openRun = runRow({ skill_ref: WA_ONLY.ref })
    const c = contactRow({ status: 'queued', consent_whatsapp_at: null }) as any
    expect(await planFirstTouch(c, NOW)).toBe('skip')
    expect(h.transition).toHaveBeenCalledWith(c, 'failed', expect.objectContaining({ data: { reason: 'no_whatsapp_consent' } }))
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })

  it('skips a contact that cannot make the move', async () => {
    skill = WA_ONLY
    openRun = runRow({ skill_ref: WA_ONLY.ref })
    h.transition.mockRejectedValue(new InvalidTransitionError('no_answer', 'interested'))
    expect(await planFirstTouch(contactRow({ status: 'no_answer' }) as any, NOW)).toBe('skip')
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })
})

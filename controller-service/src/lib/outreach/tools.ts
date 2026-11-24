import { z } from 'zod'
import * as build from './build'
import { sendOutreachTemplate } from './whatsapp'
import { outreachPool } from './db'
import { recordEvent } from './events'
import { LINES, SCRIPT_VERSION, asLanguage, isToolName, spokenTime, type ToolName } from './prompt'
import { loadCallContext, type CallContext } from './session'
import { canTransition, InvalidTransitionError, MAX_ATTEMPTS, transition } from './state'
import { nextWindowTime } from './worker'
import { LANGUAGES, type ContactStatus, type OutreachContact, type OutreachLanguage } from './types'

// POST /api/internal/outreach/calls/{callId}/tools/{tool} (plan §2). voice-service speaks `say` verbatim and does not
// run the LLM again for that turn, so every claim of success is a line from prompt.ts sent only after the action
// worked. `end` hangs up after the line; `redialLanguage` ends the call and rings back in that language.
// Every tool call is audited as a `tool_call` outreach event; status moves go through state.ts.

export interface ToolReply {
  ok: boolean
  say?: string
  end?: boolean
  redialLanguage?: OutreachLanguage
}

export interface ToolResponse {
  status: number
  body: ToolReply & { error?: string }
}

const ACTOR = 'voice'
const s = (max: number) => z.string().trim().min(1).max(max)

const ARGS = {
  recordConsent: z.object({ whatsapp: z.boolean(), recording_ack: z.boolean(), quote: z.string().trim().max(300).optional() }),
  startPreview: z.object({ business_name: s(120) }),
  addDetails: z.object({
    what_they_do: s(500).optional(),
    audience: s(500).optional(),
    highlights: z.array(s(200)).max(6).optional(),
    contact: z.object({ phone: s(20).optional(), email: s(120).optional(), whatsapp: s(20).optional() }).optional(),
    hours: s(200).optional(),
    address: s(300).optional(),
    style: s(200).optional(),
    language: z.enum(LANGUAGES).optional(),
  }),
  requestChange: z.object({ instruction: s(500) }),
  publishSite: z.object({}),
  scheduleCallback: z.object({ when: z.string().trim().min(1).max(64) }),
  markOutcome: z.object({ outcome: z.enum(['not_interested', 'wrong_number', 'other']), note: z.string().trim().max(300).optional() }),
  optOut: z.object({}),
  switchLanguage: z.object({ language: z.string().trim().max(10) }),
} satisfies Record<ToolName, z.ZodTypeAny>

type Args<T extends ToolName> = z.infer<(typeof ARGS)[T]>

interface Ctx extends CallContext {
  language: OutreachLanguage
  now: Date
}

interface Result extends ToolReply {
  detail?: Record<string, unknown>
}

const PIPELINE: ContactStatus[] = ['calling', 'interested', 'building', 'preview_sent', 'published']

async function currentStatus(contactId: string): Promise<ContactStatus | null> {
  const r = await outreachPool().query(`SELECT status FROM outreach_contacts WHERE id = $1`, [contactId])
  return r.rows[0]?.status ?? null
}

/** Moves the contact forward along calling → interested → building → preview_sent → published; never backwards. */
export async function advance(contactId: string, target: ContactStatus, callId: string, data?: Record<string, unknown>): Promise<ContactStatus | null> {
  let cur = await currentStatus(contactId)
  const ti = PIPELINE.indexOf(target)
  while (cur) {
    const ci = PIPELINE.indexOf(cur)
    if (ci < 0 || ci >= ti) return cur
    const next = canTransition(cur, target) ? target : PIPELINE[ci + 1]
    try {
      await transition({ id: contactId }, next, { actor: ACTOR, callId, data })
    } catch (e) {
      if (e instanceof InvalidTransitionError) return cur
      throw e
    }
    cur = next
  }
  return cur
}

/** A status move that may not apply (the contact moved on, or was suppressed mid-call): skipped, not an error. */
async function tryMove(contactId: string, to: ContactStatus, callId: string, opts: { data?: Record<string, unknown>; set?: Record<string, unknown> } = {}) {
  try {
    await transition({ id: contactId }, to, { actor: ACTOR, callId, ...opts })
    return true
  } catch (e) {
    if (e instanceof InvalidTransitionError) return false
    throw e
  }
}

const setCall = (callId: string, cols: Record<string, unknown>) => {
  const keys = Object.keys(cols)
  return outreachPool().query(
    `UPDATE outreach_calls SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [callId, ...keys.map(k => (cols[k] !== null && typeof cols[k] === 'object' && !(cols[k] instanceof Date) ? JSON.stringify(cols[k]) : cols[k]))]
  )
}

const lastTurns = (transcript: unknown, n: number) => (Array.isArray(transcript) ? transcript.slice(-n) : [])

/** Opt-out, honoured at once: the contact → opted_out, the number on the suppression list, its other contacts suppressed. */
export async function applyOptOut(contact: Pick<OutreachContact, 'id' | 'phone'>, callId: string, now: Date): Promise<void> {
  const pool = outreachPool()
  await setCall(callId, { outcome: 'opted_out' })
  await tryMove(contact.id, 'opted_out', callId, { set: { opted_out_at: now }, data: { source: 'call' } })
  const reason = 'Asked not to be called (outreach call)'
  await pool.query(`INSERT INTO outreach_suppressions (phone, reason, source) VALUES ($1, $2, 'call') ON CONFLICT (phone) DO NOTHING`, [contact.phone, reason])
  await recordEvent(null, 'suppression_added', { callId, actor: ACTOR, data: { phone: contact.phone, reason, source: 'call' } })
  const others = await pool.query(`SELECT id FROM outreach_contacts WHERE phone = $1 AND id <> $2 AND status NOT IN ('suppressed', 'opted_out')`, [
    contact.phone,
    contact.id,
  ])
  for (const o of others.rows as { id: string }[]) await tryMove(o.id, 'suppressed', callId, { set: { opted_out_at: now }, data: { reason, source: 'call' } })
}

/** A callback time: at least 15 minutes out, inside the calling window, at most 30 days ahead. */
export function callbackTime(when: string, now: Date): Date | null {
  const t = new Date(when)
  if (Number.isNaN(t.getTime())) return null
  const earliest = new Date(now.getTime() + 15 * 60_000)
  const latest = new Date(now.getTime() + 30 * 86_400_000)
  if (t > latest) return null
  return nextWindowTime(t < earliest ? earliest : t)
}

const HANDLERS: { [T in ToolName]: (ctx: Ctx, args: Args<T>) => Promise<Result> } = {
  async recordConsent({ call, contact, language, now }, a) {
    const evidence = {
      at: now.toISOString(),
      callId: call.id,
      channel: 'voice',
      scriptVersion: SCRIPT_VERSION,
      language,
      whatsapp: a.whatsapp,
      recordingAck: a.recording_ack,
      question: LINES[language].consentAsk,
      quote: a.quote ?? null,
      transcriptExcerpt: lastTurns(call.transcript, 6),
    }
    await setCall(call.id, { consent: evidence })
    // A "no" now withdraws an earlier yes.
    await outreachPool().query(
      `UPDATE outreach_contacts SET consent_whatsapp_at = CASE WHEN $4::boolean THEN COALESCE(consent_whatsapp_at, $2) ELSE NULL END,
              consent_evidence = $3, updated_at = now() WHERE id = $1`,
      [contact.id, now, JSON.stringify(evidence), a.whatsapp]
    )
    await recordEvent(contact.id, 'consent_recorded', { callId: call.id, actor: ACTOR, data: evidence })
    await advance(contact.id, 'interested', call.id)
    return { ok: true }
  },

  async startPreview({ call, contact, language }, a) {
    const L = LINES[language]
    if (!contact.consent_whatsapp_at) return { ok: false, say: L.consentNeeded, detail: { reason: 'no_whatsapp_consent' } }
    // build.startDraft is idempotent, moves the contact to building and mints a fresh preview link each time.
    const draft = await build.startDraft(contact.id, { businessName: a.business_name, language })
    const sent = await sendOutreachTemplate(contact.id, { template: 'preview_ready', url: draft.previewUrl, actor: ACTOR, callId: call.id })
    if (!sent.ok) return { ok: false, say: L.failedSoft, detail: { siteId: draft.siteId, whatsapp: sent.reason } }
    await advance(contact.id, 'preview_sent', call.id, { siteId: draft.siteId })
    return { ok: true, say: L.previewSent, detail: { siteId: draft.siteId, messageId: sent.messageId, mode: sent.mode } }
  },

  async addDetails({ contact }, a) {
    const brief: build.OutreachBrief = {
      whatTheyDo: a.what_they_do,
      audience: a.audience,
      highlights: a.highlights,
      contact: a.contact,
      hours: a.hours,
      address: a.address,
      style: a.style,
      language: a.language,
    }
    const given = Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== undefined)) as build.OutreachBrief
    if (!Object.keys(given).length) return { ok: true, detail: { empty: true } }
    const r = await build.mergeBrief(contact.id, given)
    return { ok: true, detail: { building: r.building, missing: r.missing } }
  },

  async requestChange({ contact, language }, a) {
    const r = await build.requestChange(contact.id, a.instruction)
    if (r.ok) return { ok: true, say: LINES[language].changeDone, detail: { summary: r.summary } }
    // build.ts words its refusals in English: spoken as they are on an English call.
    return { ok: false, say: language === 'en' && r.summary ? r.summary : LINES[language].changeFailed, detail: { summary: r.summary } }
  },

  async publishSite({ call, contact, language }) {
    const L = LINES[language]
    if (!contact.consent_whatsapp_at) return { ok: false, say: L.publishNeedsConsent, detail: { reason: 'no_whatsapp_consent' } }
    // build.publish moves the contact to published. The claim link is a bearer credential: it goes only into the
    // outreach/claim template, never into this reply or its audit row.
    const r = await build.publish(contact.id)
    await setCall(call.id, { outcome: 'published' })
    const live = await sendOutreachTemplate(contact.id, { template: 'site_live', url: r.liveUrl, actor: ACTOR, callId: call.id })
    const claim = await sendOutreachTemplate(contact.id, { template: 'claim', url: r.claimUrl, actor: ACTOR, callId: call.id })
    const linksSent = live.ok && claim.ok
    return { ok: true, say: linksSent ? L.published : L.publishedNoLinks, detail: { liveUrl: r.liveUrl, linksSent } }
  },

  async scheduleCallback({ call, contact, language, now }, a) {
    const L = LINES[language]
    if (contact.attempts >= MAX_ATTEMPTS) {
      await tryMove(contact.id, 'failed', call.id, { data: { reason: 'callback_after_max_attempts' } })
      return { ok: false, say: L.callbackCapped, end: true, detail: { reason: 'max_attempts' } }
    }
    const at = callbackTime(a.when, now)
    if (!at) return { ok: false, say: L.callbackAskTime, detail: { reason: 'bad_time', when: a.when } }
    await setCall(call.id, { outcome: 'callback', callback_at: at })
    await tryMove(contact.id, 'callback', call.id, { set: { next_attempt_at: at }, data: { callbackAt: at.toISOString() } })
    return { ok: true, say: L.callback(spokenTime(at, language)), end: true, detail: { callbackAt: at.toISOString() } }
  },

  async markOutcome({ call, contact, language }, a) {
    await setCall(call.id, { outcome: a.outcome, summary: a.note ?? null })
    await tryMove(contact.id, a.outcome === 'wrong_number' ? 'wrong_number' : 'not_interested', call.id, { data: { outcome: a.outcome, note: a.note ?? null } })
    return { ok: true, say: a.outcome === 'wrong_number' ? LINES[language].wrongNumber : LINES[language].notInterested, end: true }
  },

  async optOut({ call, contact, language, now }) {
    try {
      await applyOptOut(contact, call.id, now)
    } catch (e) {
      // Still hang up; the ended event re-applies the opt-out (call outcome opted_out).
      return { ok: false, say: LINES[language].optedOut, end: true, detail: { error: (e as Error)?.message ?? 'error' } }
    }
    return { ok: true, say: LINES[language].optedOut, end: true }
  },

  async switchLanguage({ call, contact, language }, a) {
    const to = asLanguage(a.language)
    if (to !== a.language.split('-')[0].toLowerCase()) return { ok: false, say: LINES[language].failedSoft, detail: { reason: 'unsupported', language: a.language } }
    if (to === language) return { ok: true, detail: { unchanged: true } }
    await outreachPool().query(`UPDATE outreach_contacts SET language = $2, updated_at = now() WHERE id = $1`, [contact.id, to])
    await recordEvent(contact.id, 'language_switch', { callId: call.id, actor: ACTOR, data: { from: language, to } })
    return { ok: true, say: LINES[to].switching, redialLanguage: to }
  },
}

/**
 * A build.ts refusal, said to the caller. Its message is a speakable English sentence, used as it is on an English
 * call; other languages get the matching line from prompt.ts. An opted-out contact ends the call.
 */
function buildRefusal(tool: ToolName, e: InstanceType<typeof build.OutreachBuildError>, language: OutreachLanguage): Result {
  const L = LINES[language]
  const detail = { code: e.code, error: e.message }
  if (e.code === 'opted_out') return { ok: false, say: L.optedOut, end: true, detail }
  if (language === 'en') return { ok: false, say: e.message, detail }
  const local =
    e.code === 'building' ? L.buildBusy : e.code === 'not_built' ? L.buildNeedsMore : e.code === 'details' && tool === 'publishSite' ? L.needContact : null
  return { ok: false, say: local ?? (tool === 'publishSite' ? L.publishFailed : L.failedSoft), detail }
}

export async function runTool(callId: string, tool: string, rawArgs: unknown, now: Date = new Date()): Promise<ToolResponse> {
  if (!isToolName(tool)) return { status: 404, body: { ok: false, error: `Unknown tool: ${tool}` } }
  const ctx = await loadCallContext(callId)
  if (!ctx) return { status: 404, body: { ok: false, error: 'Unknown call' } }
  const language = asLanguage(ctx.call.language ?? ctx.contact.language)
  if (ctx.call.ended_at) return { status: 409, body: { ok: false, error: 'The call has ended' } }
  const parsed = ARGS[tool].safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    const error = i ? `${i.path.join('.') || 'args'}: ${i.message}` : 'Invalid args'
    await recordEvent(ctx.contact.id, 'tool_call', { callId, actor: ACTOR, data: { tool, ok: false, error } })
    return { status: 400, body: { ok: false, error } }
  }
  const args = parsed.data
  let result: Result
  try {
    result = await (HANDLERS[tool] as (c: Ctx, a: unknown) => Promise<Result>)({ ...ctx, language, now }, args)
  } catch (e) {
    if (e instanceof build.OutreachBuildError) result = buildRefusal(tool, e, language)
    else {
      console.error(`[outreach] tool ${tool} failed for call ${callId}:`, (e as Error)?.message)
      result = { ok: false, say: LINES[language].failedSoft, detail: { error: (e as Error)?.message ?? 'error' } }
    }
  }
  const { detail, ...reply } = result
  await recordEvent(ctx.contact.id, 'tool_call', { callId, actor: ACTOR, data: { tool, args, ...reply, ...(detail ? { detail } : {}) } }).catch(() => {})
  return { status: 200, body: reply }
}

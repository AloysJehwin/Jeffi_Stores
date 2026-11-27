import { z } from 'zod'
import { LINES, spokenTime } from '../../prompt'
import { nextWindowTime } from '../../worker'
import { agentCallQuota, taskQuota, taskTime } from '../guards'
import * as runs from '../runs'
import type { ToolDef } from '../types'
import { ALL, applyOptOut, callbackTime, isEngaged, nv, refusal, s, setCall, str, tryMove } from './common'

const optOutArgs = z.object({})
export const optOut: ToolDef<typeof optOutArgs> = {
  name: 'optOut',
  description: 'They asked not to be called or contacted again. Call immediately; the call ends.',
  channels: ALL,
  effect: 'write',
  mandatory: true,
  args: optOutArgs,
  inputSchema: { type: 'object', properties: {} },
  async run({ call, contact, language, now, channel }) {
    const voice = channel === 'voice'
    try {
      await applyOptOut(contact, call?.id ?? null, now, voice ? 'call' : 'whatsapp')
    } catch (e) {
      // Still hang up; the ended event re-applies the opt-out (call outcome opted_out).
      const detail = { error: (e as Error)?.message ?? 'error' }
      return voice ? { ok: false, say: LINES[language].optedOut, end: true, detail } : { ok: false, error: 'failed', detail }
    }
    // WhatsApp: the runtime sends the one confirmation, so this tool does not.
    return voice ? { ok: true, say: LINES[language].optedOut, end: true } : { ok: true, data: { optedOut: true } }
  },
}

const handOffArgs = z.object({ reason: s(300) })
export const handOff: ToolDef<typeof handOffArgs> = {
  name: 'handOff',
  description:
    'Pass this lead to the team and stop. Use when they ask for a person, are upset, or ask about prices, payments or anything you cannot handle. After this you send nothing more until the team resumes. On a call, the call ends.',
  channels: ALL,
  effect: 'write',
  mandatory: true,
  args: handOffArgs,
  inputSchema: { type: 'object', properties: { reason: str('why the team should take over', 300) }, required: ['reason'] },
  async run({ contact, channel, actor, now }, a) {
    await runs.handOff({ contactId: contact.id, reason: a.reason, channel, actor, now })
    return { ok: true, end: true, data: { handedOff: true } }
  },
}

const scheduleCallbackArgs = z.object({ when: z.string().trim().min(1).max(64) })
export const scheduleCallback: ToolDef<typeof scheduleCallbackArgs> = {
  name: 'scheduleCallback',
  description: 'Book a call back at the time they asked for, then the call ends.',
  channels: ['voice', 'whatsapp', 'follow_up'],
  effect: 'call',
  args: scheduleCallbackArgs,
  inputSchema: {
    type: 'object',
    properties: { when: { type: 'string', description: 'ISO 8601 date-time in IST, e.g. 2026-11-25T17:00:00+05:30' } },
    required: ['when'],
  },
  async run(ctx, a) {
    const { call, contact, language, now, limits, actor, run, channel } = ctx
    const L = LINES[language]
    if (!isEngaged(contact)) {
      // Before any interest: the dialler's own retry path (status callback + next_attempt_at).
      if (contact.attempts >= limits.maxCallAttempts) {
        await tryMove(contact.id, 'failed', call?.id ?? null, { data: { reason: 'callback_after_max_attempts' } }, actor)
        return { ok: false, say: L.callbackCapped, end: true, error: 'max_attempts', detail: { reason: 'max_attempts' } }
      }
      const at = callbackTime(a.when, now)
      if (!at) return { ok: false, say: L.callbackAskTime, error: 'bad_time', detail: { reason: 'bad_time', when: a.when } }
      if (call) await setCall(call.id, { outcome: 'callback', callback_at: at })
      await tryMove(contact.id, 'callback', call?.id ?? null, { set: { next_attempt_at: at }, data: { callbackAt: at.toISOString() } }, actor)
      return { ok: true, say: L.callback(spokenTime(at, language)), end: true, ...nv({ channel }, { callbackAt: at.toISOString() }), detail: { callbackAt: at.toISOString() } }
    }
    // An engaged contact: an agent task, counted against the agent's own call and task limits.
    const q = (await agentCallQuota(contact.id, limits, now)) ?? (await taskQuota(contact.id, limits))
    if (q) return { ...refusal(q, ctx, L.callbackCapped), ...(channel === 'voice' ? { end: true } : {}) }
    const at = callbackTime(a.when, now)
    if (!at) return { ok: false, say: L.callbackAskTime, error: 'bad_time', detail: { reason: 'bad_time', when: a.when } }
    if (!run) return { ok: false, error: 'no_run' }
    await runs.scheduleTask({ runId: run.id, contactId: contact.id, kind: 'call', dueAt: at, reason: 'callback', createdBy: actor })
    return { ok: true, say: L.callback(spokenTime(at, language)), end: true, data: { callbackAt: at.toISOString() }, detail: { callbackAt: at.toISOString() } }
  },
}

const placeCallArgs = z.object({})
export const placeCall: ToolDef<typeof placeCallArgs> = {
  name: 'placeCall',
  description: 'Call them now, when they ask for a call on WhatsApp. The call goes out within a minute, inside calling hours (09:30 to 20:30 IST); outside them it waits for the next window.',
  channels: ['whatsapp', 'follow_up'],
  effect: 'call',
  args: placeCallArgs,
  inputSchema: { type: 'object', properties: {} },
  async run(ctx) {
    const { contact, now, limits, actor, run } = ctx
    if (!isEngaged(contact)) return refusal('not_engaged', ctx)
    if (contact.dnd_status === 'dnd') return refusal('dnd', ctx)
    const q = (await agentCallQuota(contact.id, limits, now)) ?? (await taskQuota(contact.id, limits))
    if (q) return refusal(q, ctx)
    if (!run) return refusal('no_run', ctx)
    const due = nextWindowTime(now)
    await runs.scheduleTask({ runId: run.id, contactId: contact.id, kind: 'call', dueAt: due, reason: 'requested', createdBy: actor })
    return { ok: true, data: { callAt: due.toISOString() }, detail: { dueAt: due.toISOString() } }
  },
}

const scheduleFollowUpArgs = z
  .object({
    when: z.string().trim().min(1).max(64).optional(),
    in_hours: z.number().min(0.25).max(720).optional(),
    instruction: s(500),
    reason: z.string().trim().max(120).optional(),
  })
  .refine(a => (a.when === undefined) !== (a.in_hours === undefined), { message: 'give exactly one of when or in_hours' })
export const scheduleFollowUp: ToolDef<typeof scheduleFollowUpArgs> = {
  name: 'scheduleFollowUp',
  description: 'Wake yourself later on WhatsApp with a note to yourself on what to do. Give exactly one of when or in_hours. At least 15 minutes ahead, at most 30 days.',
  channels: ALL,
  effect: 'write',
  args: scheduleFollowUpArgs,
  inputSchema: {
    type: 'object',
    properties: {
      when: { type: 'string', description: 'ISO 8601 date-time, e.g. 2026-11-25T17:00:00+05:30' },
      in_hours: { type: 'number', minimum: 0.25, maximum: 720, description: 'hours from now' },
      instruction: str('what to do when you wake up, written to yourself', 500),
      reason: str('a short label for the team', 120),
    },
    required: ['instruction'],
  },
  async run(ctx, a) {
    const { contact, now, limits, actor, run } = ctx
    const asked = a.when !== undefined ? new Date(a.when) : new Date(now.getTime() + (a.in_hours as number) * 3_600_000)
    const at = taskTime(asked, now, limits)
    if (!at) return refusal('bad_time', ctx)
    const q = await taskQuota(contact.id, limits)
    if (q) return refusal(q, ctx)
    if (!run) return refusal('no_run', ctx)
    await runs.scheduleTask({ runId: run.id, contactId: contact.id, kind: 'whatsapp_turn', dueAt: at, reason: a.reason ?? null, instruction: a.instruction, createdBy: actor })
    return { ok: true, data: { scheduledFor: at.toISOString() }, detail: { dueAt: at.toISOString() } }
  },
}

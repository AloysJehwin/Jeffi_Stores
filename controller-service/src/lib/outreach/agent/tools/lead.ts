import { z } from 'zod'
import { outreachPool } from '../../db'
import { recordEvent } from '../../events'
import { LINES } from '../../prompt'
import { knownBrief } from '../../session'
import { windowOpen } from '../../whatsapp'
import { LANGUAGES } from '../../types'
import { maskPhone } from '../guards'
import type { ToolDef } from '../types'
import { advance, ALL, isPublished, lastMessages, lastTurns, nv, s, setCall, siteOf, str, tryMove } from './common'

const firstName = (n: string | null) => (n?.trim().split(/\s+/)[0] || null)

const getLeadArgs = z.object({})
export const getLead: ToolDef<typeof getLeadArgs> = {
  name: 'getLead',
  description: 'Read what we know about this lead: business, owner, language, status, WhatsApp consent, attempts, what they already told us, site state. Phone is masked.',
  channels: ALL,
  effect: 'read',
  args: getLeadArgs,
  inputSchema: { type: 'object', properties: {} },
  async run({ contact, call, now }) {
    const [known, last, site] = await Promise.all([
      knownBrief(contact.id).catch(() => ({})),
      outreachPool()
        .query(`SELECT outcome, status FROM outreach_calls WHERE contact_id = $1 AND ended_at IS NOT NULL AND id IS DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1`, [contact.id, call?.id ?? null])
        .then(r => r.rows[0] as { outcome: string | null; status: string } | undefined)
        .catch(() => undefined),
      siteOf(contact),
    ])
    return {
      ok: true,
      data: {
        business: contact.business_name,
        ownerFirstName: firstName(contact.owner_name),
        category: contact.category,
        city: contact.city,
        language: contact.language,
        status: contact.status,
        phone: maskPhone(contact.phone),
        consent: { whatsapp: !!contact.consent_whatsapp_at, at: contact.consent_whatsapp_at },
        optedOut: !!contact.opted_out_at || contact.status === 'opted_out',
        handoff: contact.handoff_at ? { at: contact.handoff_at, reason: contact.handoff_reason } : null,
        attempts: contact.attempts,
        known,
        site: { started: !!contact.showcase_site_id, status: site?.status ?? null, published: isPublished(contact), claimed: contact.status === 'claimed' },
        whatsappWindowOpen: windowOpen(contact, now),
        lastCall: last ? { outcome: last.outcome, status: last.status } : null,
      },
    }
  },
}

const updateLeadArgs = z.object({ owner_name: s(120).optional(), language: z.enum(LANGUAGES).optional(), category: s(120).optional(), city: s(120).optional(), note: s(500).optional() })
export const updateLead: ToolDef<typeof updateLeadArgs> = {
  name: 'updateLead',
  description: "Correct or add to the lead's record: the owner's name, preferred language, category, city, or a short note. Never changes status.",
  channels: ALL,
  effect: 'write',
  args: updateLeadArgs,
  inputSchema: {
    type: 'object',
    properties: {
      owner_name: str("the owner's name as they said it", 120),
      language: { type: 'string', enum: [...LANGUAGES], description: 'their preferred language' },
      category: str('what kind of business it is', 120),
      city: str('the city or town', 120),
      note: str('a short note worth keeping for later', 500),
    },
  },
  async run({ contact, actor, call, now }, a) {
    const sets: string[] = []
    const params: unknown[] = [contact.id]
    const fields: string[] = []
    for (const k of ['owner_name', 'language', 'category', 'city'] as const) {
      if (a[k] === undefined) continue
      params.push(a[k])
      sets.push(`${k} = $${params.length}`)
      fields.push(k)
    }
    if (a.note) {
      const old = Array.isArray((contact.extra as { notes?: unknown })?.notes) ? ((contact.extra as { notes: unknown[] }).notes as unknown[]) : []
      params.push(JSON.stringify([...old, { at: now.toISOString(), text: a.note }].slice(-20)))
      sets.push(`extra = jsonb_set(COALESCE(extra, '{}'::jsonb), '{notes}', $${params.length}::jsonb)`)
      fields.push('note')
    }
    if (!sets.length) return { ok: true, detail: { empty: true } }
    await outreachPool().query(`UPDATE outreach_contacts SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params)
    await recordEvent(contact.id, 'lead_updated', { callId: call?.id ?? null, actor, data: { fields } })
    return { ok: true, data: { updated: fields } }
  },
}

const recordConsentArgs = z.object({ whatsapp: z.boolean(), recording_ack: z.boolean(), quote: z.string().trim().max(300).optional() })
export const recordConsent: ToolDef<typeof recordConsentArgs> = {
  name: 'recordConsent',
  description: 'Record their answer to sending links on WhatsApp. Call once they answer the WhatsApp question.',
  channels: ['voice', 'whatsapp'],
  effect: 'write',
  args: recordConsentArgs,
  inputSchema: {
    type: 'object',
    properties: {
      whatsapp: { type: 'boolean', description: 'true only if they clearly agreed to WhatsApp messages on this number' },
      recording_ack: { type: 'boolean', description: 'true if they carried on after hearing the call may be recorded' },
      quote: str('their exact words when answering', 300),
    },
    required: ['whatsapp', 'recording_ack'],
  },
  async run({ call, contact, language, now, channel, actor, scriptVersion }, a) {
    const evidence = {
      at: now.toISOString(),
      callId: call?.id ?? null,
      channel,
      scriptVersion,
      language,
      whatsapp: a.whatsapp,
      recordingAck: a.recording_ack,
      question: LINES[language].consentAsk,
      quote: a.quote ?? null,
      transcriptExcerpt: call ? lastTurns(call.transcript, 6) : await lastMessages(contact.id, 6),
    }
    if (call) await setCall(call.id, { consent: evidence })
    // A "no" now withdraws an earlier yes.
    await outreachPool().query(
      `UPDATE outreach_contacts SET consent_whatsapp_at = CASE WHEN $4::boolean THEN COALESCE(consent_whatsapp_at, $2) ELSE NULL END,
              consent_evidence = $3, updated_at = now() WHERE id = $1`,
      [contact.id, now, JSON.stringify(evidence), a.whatsapp]
    )
    await recordEvent(contact.id, 'consent_recorded', { callId: call?.id ?? null, actor, data: evidence })
    await advance(contact.id, 'interested', call?.id ?? null, undefined, actor)
    return { ok: true, ...nv({ channel }, { consent: a.whatsapp }) }
  },
}

const markOutcomeArgs = z.object({ outcome: z.enum(['not_interested', 'wrong_number', 'other']), note: z.string().trim().max(300).optional() })
export const markOutcome: ToolDef<typeof markOutcomeArgs> = {
  name: 'markOutcome',
  description: 'Record why the call is ending without a website, then the call ends.',
  channels: ALL,
  effect: 'write',
  args: markOutcomeArgs,
  inputSchema: {
    type: 'object',
    properties: { outcome: { type: 'string', enum: ['not_interested', 'wrong_number', 'other'] }, note: str('a short reason', 300) },
    required: ['outcome'],
  },
  async run({ call, contact, language, actor, channel }, a) {
    if (call) await setCall(call.id, { outcome: a.outcome, summary: a.note ?? null })
    await tryMove(contact.id, a.outcome === 'wrong_number' ? 'wrong_number' : 'not_interested', call?.id ?? null, { data: { outcome: a.outcome, note: a.note ?? null } }, actor)
    return { ok: true, say: a.outcome === 'wrong_number' ? LINES[language].wrongNumber : LINES[language].notInterested, end: true, ...nv({ channel }, { outcome: a.outcome }) }
  },
}

const logOutcomeArgs = z.object({ outcome: s(40), note: z.string().trim().max(500).optional(), tags: z.array(s(30)).max(5).optional() })
export const logOutcome: ToolDef<typeof logOutcomeArgs> = {
  name: 'logOutcome',
  description: 'Write a structured note about how this conversation went. It ends nothing and sends nothing.',
  channels: ALL,
  effect: 'write',
  args: logOutcomeArgs,
  inputSchema: {
    type: 'object',
    properties: {
      outcome: str('one short label, e.g. interested, needs_time, asked_price', 40),
      note: str('what happened, in a sentence or two', 500),
      tags: { type: 'array', items: str('a tag', 30), maxItems: 5 },
    },
    required: ['outcome'],
  },
  async run({ contact, call, run, channel, actor }, a) {
    await recordEvent(contact.id, 'agent_note', { callId: call?.id ?? null, actor, data: { outcome: a.outcome, note: a.note ?? null, tags: a.tags ?? [], channel, runId: run?.id ?? null } })
    return { ok: true }
  },
}

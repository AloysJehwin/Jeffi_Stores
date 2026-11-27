import { z } from 'zod'
import * as build from '../../build'
import { missingOf, readBrief } from '../../build/brief'
import { createClaimToken } from '../../claim'
import { outreachPool } from '../../db'
import { LINES } from '../../prompt'
import { sendOutreachTemplate, sendOutreachText } from '../../whatsapp'
import { deniesBeingAi, sendQuota } from '../guards'
import type { ToolDef, ToolResult } from '../types'
import { advance, ALL, isPublished, lastMessages, linkFor, liveUrlOf, refusal, siteOf, str } from './common'

const sendLinkArgs = z.object({ kind: z.enum(['preview', 'live', 'claim']) })
export const sendLink: ToolDef<typeof sendLinkArgs> = {
  name: 'sendLink',
  description:
    'Send them a link on WhatsApp: the preview of their draft, the live site, or the link to claim it. The address is added by the system; you never see it. Needs their WhatsApp consent.',
  channels: ALL,
  effect: 'send',
  args: sendLinkArgs,
  inputSchema: {
    type: 'object',
    properties: { kind: { type: 'string', enum: ['preview', 'live', 'claim'], description: 'which link to send' } },
    required: ['kind'],
  },
  async run(ctx, a) {
    const { contact, language, limits, now, actor, call } = ctx
    const L = LINES[language]
    const q = await sendQuota(contact.id, 'template', limits, now)
    if (q) return refusal(q, ctx, L.failedSoft)
    const published = isPublished(contact)
    let template: 'preview_ready' | 'site_live' | 'claim'
    let url: string | null
    if (a.kind === 'preview') {
      if (!contact.showcase_site_id) return refusal('no_draft', ctx)
      if (published) return refusal('already_published', ctx)
      template = 'preview_ready'
      // build.startDraft is idempotent and mints a fresh preview link each time.
      url = (await build.startDraft(contact.id, { businessName: contact.business_name, language })).previewUrl
    } else if (a.kind === 'live') {
      if (!published) return refusal('not_published', ctx)
      template = 'site_live'
      url = await liveUrlOf(contact)
    } else {
      if (!published) return refusal('not_published', ctx)
      if (contact.status === 'claimed') return refusal('already_claimed', ctx)
      template = 'claim'
      // The claim link is a bearer credential: straight into the template, never into data, detail or the audit row.
      url = (await createClaimToken(contact.id))?.url ?? null
    }
    if (!url) return refusal('no_site', ctx)
    const sent = await sendOutreachTemplate(contact.id, { template, url, actor, callId: call?.id ?? null }, now)
    if (!sent.ok) return { ...refusal(sent.reason, ctx, L.failedSoft), detail: { whatsapp: sent.reason } }
    if (a.kind === 'preview') await advance(contact.id, 'preview_sent', call?.id ?? null, undefined, actor)
    return { ok: true, data: { sent: true, kind: a.kind, mode: sent.mode }, detail: { messageId: sent.messageId } }
  },
}

const sendTemplateArgs = z.object({ template: z.enum(['details_needed', 'callback', 'trial_ending']), missing: z.array(z.string().trim().min(1).max(60)).max(8).optional() })
export const sendWhatsAppTemplate: ToolDef<typeof sendTemplateArgs> = {
  name: 'sendWhatsAppTemplate',
  description:
    'Send one of the approved WhatsApp messages: details_needed (what we still need for their site), callback (confirms the call back time we booked), trial_ending (their trial is about to end). The button link is added by the system. Needs their WhatsApp consent.',
  channels: ALL,
  effect: 'send',
  args: sendTemplateArgs,
  inputSchema: {
    type: 'object',
    properties: {
      template: { type: 'string', enum: ['details_needed', 'callback', 'trial_ending'] },
      missing: { type: 'array', items: str('one missing detail', 60), maxItems: 8, description: 'details_needed only: what is still missing; defaults to what the site brief lacks' },
    },
    required: ['template'],
  },
  async run(ctx, a) {
    const { contact, language, limits, now, actor, call } = ctx
    const q = await sendQuota(contact.id, 'template', limits, now)
    if (q) return refusal(q, ctx, LINES[language].failedSoft)
    let callbackAt: Date | undefined
    let trialEndsAt: Date | undefined
    if (a.template === 'callback') {
      const r = await outreachPool().query(`SELECT due_at FROM outreach_agent_tasks WHERE contact_id = $1 AND kind = 'call' AND status = 'pending' ORDER BY due_at LIMIT 1`, [contact.id])
      const due = r.rows[0]?.due_at ?? (contact.status === 'callback' ? contact.next_attempt_at : null)
      if (!due) return refusal('no_callback', ctx)
      callbackAt = new Date(due)
    }
    if (a.template === 'trial_ending') {
      const end = (await siteOf(contact))?.trialEndsAt
      if (!end) return refusal('no_trial', ctx)
      trialEndsAt = new Date(end)
    }
    const url = await linkFor(contact, language)
    if (!url) return refusal('no_site', ctx)
    const missing = a.template === 'details_needed' ? (a.missing?.length ? a.missing : (missingOf(readBrief(contact.extra)) as string[])) : undefined
    const sent = await sendOutreachTemplate(contact.id, { template: a.template, url, missing, callbackAt, trialEndsAt, actor, callId: call?.id ?? null }, now)
    if (!sent.ok) return { ...refusal(sent.reason, ctx, LINES[language].failedSoft), detail: { whatsapp: sent.reason } }
    return { ok: true, data: { sent: true, template: a.template, mode: sent.mode }, detail: { messageId: sent.messageId } }
  },
}

const sendTextArgs = z.object({ text: z.string().trim().min(1).max(1000) })
export const sendWhatsAppText: ToolDef<typeof sendTextArgs> = {
  name: 'sendWhatsAppText',
  description: 'Send them a WhatsApp message in your own words. Works only while their 24 hour chat window is open and with their consent. Short, plain text; no links.',
  channels: ['whatsapp', 'follow_up'],
  effect: 'send',
  args: sendTextArgs,
  inputSchema: { type: 'object', properties: { text: str('the message to send', 1000) }, required: ['text'] },
  async run(ctx, a) {
    const { contact, limits, now, actor } = ctx
    // Never claim to be human, whatever the skill says.
    if (deniesBeingAi(a.text)) return { ok: false, error: 'denies_ai', data: { note: 'Never say you are a person or not an AI. Rewrite the message.' } }
    const q = await sendQuota(contact.id, 'text', limits, now)
    if (q) return refusal(q, ctx)
    const sent = await sendOutreachText(contact.id, a.text, { actor }, now)
    if (!sent.ok) return refusal(sent.reason, ctx)
    return { ok: true, data: { sent: true, mode: sent.mode }, detail: { messageId: sent.messageId } }
  },
}

const readMessagesArgs = z.object({ limit: z.number().int().min(1).max(20).optional() })
export const readMessages: ToolDef<typeof readMessagesArgs> = {
  name: 'readMessages',
  description: 'Read the latest WhatsApp messages with this lead, oldest first. Claim links are hidden.',
  channels: ALL,
  effect: 'read',
  args: readMessagesArgs,
  inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20, description: 'how many messages, default 10' } } },
  async run({ contact }, a): Promise<ToolResult> {
    const messages = await lastMessages(contact.id, a.limit ?? 10)
    return { ok: true, data: { messages } }
  },
}

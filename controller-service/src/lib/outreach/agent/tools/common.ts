import { z } from 'zod'
import { showcaseUrl } from '@/lib/showcase/host'
import { getShowcaseById, type ShowcaseSiteRow } from '@/lib/showcase/store'
import * as build from '../../build'
import { outreachPool } from '../../db'
import { recordEvent } from '../../events'
import { canTransition, InvalidTransitionError, transition } from '../../state'
import { nextWindowTime } from '../../worker'
import type { ContactStatus, OutreachContact } from '../../types'
import type { AgentChannel, ToolContext, ToolResult } from '../types'

export const ALL: readonly AgentChannel[] = ['voice', 'whatsapp', 'follow_up']
export const s = (max: number) => z.string().trim().min(1).max(max)
export const str = (description: string, maxLength = 500) => ({ type: 'string', description, maxLength })

const VOICE = 'voice'
export const PIPELINE: ContactStatus[] = ['calling', 'interested', 'building', 'preview_sent', 'published']
/** A contact that said yes to something: callbacks and calls to it are agent tasks, not the dialler's retries. */
export const ENGAGED: ContactStatus[] = ['interested', 'building', 'preview_sent', 'published', 'claimed']
export const isEngaged = (c: Pick<OutreachContact, 'status'>) => ENGAGED.includes(c.status)
export const isPublished = (c: Pick<OutreachContact, 'status'>) => c.status === 'published' || c.status === 'claimed'

/** Data for the LLM on WhatsApp and follow-ups only: voice replies stay exactly as the legacy script had them. */
export const nv = (ctx: Pick<ToolContext, 'channel'>, data: Record<string, unknown>): Pick<ToolResult, 'data'> => (ctx.channel === VOICE ? {} : { data })

async function currentStatus(contactId: string): Promise<ContactStatus | null> {
  const r = await outreachPool().query(`SELECT status FROM outreach_contacts WHERE id = $1`, [contactId])
  return r.rows[0]?.status ?? null
}

/** Moves the contact forward along calling → interested → building → preview_sent → published; never backwards. */
export async function advance(contactId: string, target: ContactStatus, callId: string | null, data?: Record<string, unknown>, actor = VOICE): Promise<ContactStatus | null> {
  let cur = await currentStatus(contactId)
  const ti = PIPELINE.indexOf(target)
  while (cur) {
    const ci = PIPELINE.indexOf(cur)
    if (ci < 0 || ci >= ti) return cur
    const next = canTransition(cur, target) ? target : PIPELINE[ci + 1]
    try {
      await transition({ id: contactId }, next, { actor, callId, data })
    } catch (e) {
      if (e instanceof InvalidTransitionError) return cur
      throw e
    }
    cur = next
  }
  return cur
}

/** A status move that may not apply (the contact moved on, or was suppressed mid-call): skipped, not an error. */
export async function tryMove(contactId: string, to: ContactStatus, callId: string | null, opts: { data?: Record<string, unknown>; set?: Record<string, unknown> } = {}, actor = VOICE) {
  try {
    await transition({ id: contactId }, to, { actor, callId, ...opts })
    return true
  } catch (e) {
    if (e instanceof InvalidTransitionError) return false
    throw e
  }
}

export const setCall = (callId: string, cols: Record<string, unknown>) => {
  const keys = Object.keys(cols)
  return outreachPool().query(
    `UPDATE outreach_calls SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [callId, ...keys.map(k => (cols[k] !== null && typeof cols[k] === 'object' && !(cols[k] instanceof Date) ? JSON.stringify(cols[k]) : cols[k]))]
  )
}

export const lastTurns = (transcript: unknown, n: number) => (Array.isArray(transcript) ? transcript.slice(-n) : [])

const CLAIM_RE = /\S*\/claim\/[A-Za-z0-9._-]+/g
/** A claim link is a bearer credential: never shown to the LLM or kept in an excerpt. */
export const maskClaimLinks = (t: string) => t.replace(CLAIM_RE, '[claim link]')

/** The last n WhatsApp messages, oldest first, claim links masked. */
export async function lastMessages(contactId: string, n: number): Promise<{ direction: 'in' | 'out'; template: string | null; at: string; body: string }[]> {
  const r = await outreachPool().query(
    `SELECT direction, template_slug, body, created_at FROM outreach_messages WHERE contact_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [contactId, n]
  )
  return (r.rows as { direction: 'in' | 'out'; template_slug: string | null; body: string | null; created_at: string | Date }[])
    .map(m => ({ direction: m.direction, template: m.template_slug ?? null, at: new Date(m.created_at).toISOString(), body: maskClaimLinks(m.body ?? '').slice(0, 500) }))
    .reverse()
}

/** Opt-out, honoured at once: the contact → opted_out, the number on the suppression list, its other contacts suppressed. */
export async function applyOptOut(contact: Pick<OutreachContact, 'id' | 'phone'>, callId: string | null, now: Date, source: 'call' | 'whatsapp' = 'call'): Promise<void> {
  const pool = outreachPool()
  const actor = source === 'call' ? VOICE : 'outreach:whatsapp'
  const reason = source === 'call' ? 'Asked not to be called (outreach call)' : 'whatsapp_stop'
  if (callId) await setCall(callId, { outcome: 'opted_out' })
  await tryMove(contact.id, 'opted_out', callId, { set: { opted_out_at: now }, data: { source } }, actor)
  await pool.query(`INSERT INTO outreach_suppressions (phone, reason, source) VALUES ($1, $2, $3) ON CONFLICT (phone) DO NOTHING`, [contact.phone, reason, source])
  await recordEvent(null, 'suppression_added', { callId, actor, data: { phone: contact.phone, reason, source } })
  const others = await pool.query(`SELECT id FROM outreach_contacts WHERE phone = $1 AND id <> $2 AND status NOT IN ('suppressed', 'opted_out')`, [contact.phone, contact.id])
  for (const o of others.rows as { id: string }[]) await tryMove(o.id, 'suppressed', callId, { set: { opted_out_at: now }, data: { reason, source } }, actor)
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

export async function siteOf(contact: Pick<OutreachContact, 'showcase_site_id'>): Promise<ShowcaseSiteRow | null> {
  if (!contact.showcase_site_id) return null
  return getShowcaseById(contact.showcase_site_id).catch(() => null)
}

/** The live site's address (the same showcaseUrl publish returns), or null when there is no site. */
export async function liveUrlOf(contact: Pick<OutreachContact, 'showcase_site_id'>): Promise<string | null> {
  const site = await siteOf(contact)
  return site ? showcaseUrl(site.slug) : null
}

/** The button URL for a template: the live site once published, else a fresh preview link. Null when there is no draft. */
export async function linkFor(contact: OutreachContact, language: string): Promise<string | null> {
  if (isPublished(contact)) return liveUrlOf(contact)
  if (!contact.showcase_site_id) return null
  return (await build.startDraft(contact.id, { businessName: contact.business_name, language })).previewUrl
}

/** A refused side effect: the code for the LLM, and on voice optionally a line to say. */
export const refusal = (code: string, ctx: Pick<ToolContext, 'channel'>, say?: string): ToolResult => ({
  ok: false,
  error: code,
  ...(ctx.channel === VOICE && say ? { say } : {}),
})

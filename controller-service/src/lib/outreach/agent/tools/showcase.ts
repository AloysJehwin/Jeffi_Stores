import { z } from 'zod'
import * as build from '../../build'
import { missingOf, readBrief } from '../../build/brief'
import { readBuild } from '../../build/state'
import { LINES } from '../../prompt'
import { LANGUAGES } from '../../types'
import { sendOutreachTemplate } from '../../whatsapp'
import { sendQuota } from '../guards'
import type { ToolDef } from '../types'
import { advance, ALL, isPublished, nv, s, setCall, siteOf, str } from './common'

const getSiteStatusArgs = z.object({})
export const getSiteStatus: ToolDef<typeof getSiteStatusArgs> = {
  name: 'getSiteStatus',
  description: "Read where their website stands: not started, being designed, ready to preview, live or claimed, and which details are still missing.",
  channels: ALL,
  effect: 'read',
  args: getSiteStatusArgs,
  inputSchema: { type: 'object', properties: {} },
  async run({ contact }) {
    const b = readBuild(contact.extra)
    const site = await siteOf(contact)
    const published = isPublished(contact)
    return {
      ok: true,
      data: {
        started: !!contact.showcase_site_id,
        siteStatus: site?.status ?? null,
        published,
        claimed: contact.status === 'claimed',
        previewAvailable: !!contact.showcase_site_id && !published,
        build: { state: b.state, builds: b.builds, designed: !!b.builtAt, ...(b.error ? { error: b.error.slice(0, 200) } : {}) },
        missing: missingOf(readBrief(contact.extra)),
      },
    }
  },
}

const startPreviewArgs = z.object({ business_name: s(120) })
export const startPreview: ToolDef<typeof startPreviewArgs> = {
  name: 'startPreview',
  description: 'Start their website draft and, with WhatsApp consent, send the preview link. Call once, after confirming the business name.',
  channels: ['voice', 'whatsapp', 'follow_up'],
  effect: 'send',
  args: startPreviewArgs,
  inputSchema: { type: 'object', properties: { business_name: str('the business name as they confirmed it', 120) }, required: ['business_name'] },
  async run({ call, contact, language, actor, channel, limits, now }, a) {
    const L = LINES[language]
    if (!contact.consent_whatsapp_at) return { ok: false, say: L.consentNeeded, error: 'no_whatsapp_consent', detail: { reason: 'no_whatsapp_consent' } }
    const q = await sendQuota(contact.id, 'template', limits, now)
    if (q) return { ok: false, say: L.failedSoft, error: q, detail: { reason: q } }
    // build.startDraft is idempotent, moves the contact to building and mints a fresh preview link each time.
    const draft = await build.startDraft(contact.id, { businessName: a.business_name, language })
    const sent = await sendOutreachTemplate(contact.id, { template: 'preview_ready', url: draft.previewUrl, actor, callId: call?.id ?? null })
    if (!sent.ok) return { ok: false, say: L.failedSoft, error: sent.reason, detail: { siteId: draft.siteId, whatsapp: sent.reason } }
    await advance(contact.id, 'preview_sent', call?.id ?? null, { siteId: draft.siteId }, actor)
    return { ok: true, say: L.previewSent, ...nv({ channel }, { sent: true, kind: 'preview', mode: sent.mode }), detail: { siteId: draft.siteId, messageId: sent.messageId, mode: sent.mode } }
  },
}

const addDetailsArgs = z.object({
  what_they_do: s(500).optional(),
  audience: s(500).optional(),
  highlights: z.array(s(200)).max(6).optional(),
  contact: z.object({ phone: s(20).optional(), email: s(120).optional(), whatsapp: s(20).optional() }).optional(),
  hours: s(200).optional(),
  address: s(300).optional(),
  style: s(200).optional(),
  language: z.enum(LANGUAGES).optional(),
})
export const addDetails: ToolDef<typeof addDetailsArgs> = {
  name: 'addDetails',
  description: 'Save details for their website as they give them. Pass only what they just said; leave out anything unknown.',
  channels: ['voice', 'whatsapp'],
  effect: 'write',
  args: addDetailsArgs,
  inputSchema: {
    type: 'object',
    properties: {
      what_they_do: str('what the business does or sells'),
      audience: str('who their customers are'),
      highlights: { type: 'array', items: str('one highlight', 200), maxItems: 6 },
      contact: {
        type: 'object',
        properties: { phone: str('phone to show on the site', 20), email: str('email to show on the site', 120), whatsapp: str('WhatsApp number to show', 20) },
      },
      hours: str('opening hours', 200),
      address: str('address or area', 300),
      style: str('a look or style they like', 200),
      language: { type: 'string', enum: [...LANGUAGES], description: "the website's language, if they asked for one" },
    },
  },
  async run({ contact, channel }, a) {
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
    return { ok: true, ...nv({ channel }, { building: r.building, missing: r.missing }), detail: { building: r.building, missing: r.missing } }
  },
}

const requestChangeArgs = z.object({ instruction: s(500) })
export const requestChange: ToolDef<typeof requestChangeArgs> = {
  name: 'requestChange',
  description: 'Change something on their preview site, in their words.',
  channels: ['voice', 'whatsapp'],
  effect: 'write',
  args: requestChangeArgs,
  inputSchema: { type: 'object', properties: { instruction: str('the change they asked for') }, required: ['instruction'] },
  async run({ contact, language, channel }, a) {
    const r = await build.requestChange(contact.id, a.instruction)
    if (r.ok) return { ok: true, say: LINES[language].changeDone, ...nv({ channel }, { changed: true, summary: r.summary }), detail: { summary: r.summary } }
    // build.ts words its refusals in English: spoken as they are on an English call.
    return { ok: false, say: language === 'en' && r.summary ? r.summary : LINES[language].changeFailed, error: 'change_failed', ...nv({ channel }, { summary: r.summary }), detail: { summary: r.summary } }
  },
}

const publishSiteArgs = z.object({})
export const publishSite: ToolDef<typeof publishSiteArgs> = {
  name: 'publishSite',
  description: 'Make their website live. Only after they say yes to making it live.',
  channels: ['voice', 'whatsapp'],
  effect: 'send',
  args: publishSiteArgs,
  inputSchema: { type: 'object', properties: {} },
  async run({ call, contact, language, actor, channel, limits, now }) {
    const L = LINES[language]
    if (!contact.consent_whatsapp_at) return { ok: false, say: L.publishNeedsConsent, error: 'no_whatsapp_consent', detail: { reason: 'no_whatsapp_consent' } }
    // Over the template limit the site still goes live; the links wait for the team (publishedNoLinks).
    const quota = await sendQuota(contact.id, 'template', limits, now)
    // build.publish moves the contact to published. The claim link is a bearer credential: it goes only into the
    // outreach/claim template, never into this reply or its audit row.
    const r = await build.publish(contact.id)
    if (call) await setCall(call.id, { outcome: 'published' })
    const live = quota ? null : await sendOutreachTemplate(contact.id, { template: 'site_live', url: r.liveUrl, actor, callId: call?.id ?? null })
    const claim = quota ? null : await sendOutreachTemplate(contact.id, { template: 'claim', url: r.claimUrl, actor, callId: call?.id ?? null })
    const linksSent = !!live?.ok && !!claim?.ok
    return { ok: true, say: linksSent ? L.published : L.publishedNoLinks, ...nv({ channel }, { published: true, linksSent }), detail: { liveUrl: r.liveUrl, linksSent } }
  },
}

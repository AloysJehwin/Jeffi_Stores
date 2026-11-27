import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(), transition: vi.fn(), startDraft: vi.fn(), send: vi.fn(), sendText: vi.fn(), createClaimToken: vi.fn(), getShowcaseById: vi.fn(), sendQuota: vi.fn(),
}))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/session', () => ({ knownBrief: vi.fn(), readVoiceSettings: vi.fn() }))
vi.mock('@controller/lib/outreach/whatsapp', () => ({ sendOutreachTemplate: h.send, sendOutreachText: h.sendText, windowOpen: vi.fn() }))
vi.mock('@controller/lib/outreach/build', () => ({ OutreachBuildError: class extends Error {}, startDraft: h.startDraft }))
vi.mock('@controller/lib/outreach/claim', () => ({ createClaimToken: h.createClaimToken }))
vi.mock('@controller/lib/outreach/state', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/state')>()), transition: h.transition }))
vi.mock('@controller/lib/outreach/suppress', () => ({ isSuppressed: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/guards', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/agent/guards')>()), sendQuota: h.sendQuota }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById: h.getShowcaseById }))

import { readMessages, sendLink, sendWhatsAppTemplate, sendWhatsAppText } from '@controller/lib/outreach/agent/tools/messaging'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'

const NOW = new Date('2026-11-27T06:00:00Z')
let status = 'preview_sent'
const ctx = (contact: Record<string, unknown> = {}, o: Record<string, unknown> = {}) =>
  ({
    channel: 'whatsapp', actor: 'outreach:agent',
    contact: { id: 'k1', business_name: 'Ravi Stores', status, language: 'en', consent_whatsapp_at: '2026-11-26T05:00:00Z', showcase_site_id: 's1', extra: {}, ...contact },
    call: null, run: { id: 'r1' }, language: 'en', now: NOW, limits: HARD_LIMITS, scriptVersion: 'x', ...o,
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
  status = 'preview_sent'
  h.query.mockImplementation(async (sql: string) => (sql.startsWith('SELECT status') ? { rows: [{ status }] } : { rows: [], rowCount: 1 }))
  h.transition.mockImplementation(async (_c: unknown, to: string) => {
    status = to
    return {}
  })
  h.sendQuota.mockResolvedValue(null)
  h.send.mockResolvedValue({ ok: true, mode: 'captured', messageId: 'm1', providerMessageId: null })
  h.sendText.mockResolvedValue({ ok: true, mode: 'captured', messageId: 'm2', providerMessageId: null })
  h.startDraft.mockResolvedValue({ siteId: 's1', previewUrl: 'https://site-x/preview?t=fresh' })
  h.getShowcaseById.mockResolvedValue({ slug: 'ravi-stores', status: 'live', trialEndsAt: '2026-12-04T00:00:00Z' })
})

describe('sendLink', () => {
  it('preview: a fresh link from startDraft in the preview_ready template, data without the URL', async () => {
    const r = await sendLink.run(ctx({ status: 'building' }), { kind: 'preview' })
    expect(h.sendQuota).toHaveBeenCalledWith('k1', 'template', HARD_LIMITS, NOW)
    expect(h.startDraft).toHaveBeenCalledWith('k1', { businessName: 'Ravi Stores', language: 'en' })
    expect(h.send).toHaveBeenCalledWith('k1', { template: 'preview_ready', url: 'https://site-x/preview?t=fresh', actor: 'outreach:agent', callId: null }, NOW)
    expect(r.data).toEqual({ sent: true, kind: 'preview', mode: 'captured' })
    expect(JSON.stringify(r)).not.toContain('t=fresh')
  })

  it('refuses without a draft, and a preview once published', async () => {
    expect(await sendLink.run(ctx({ showcase_site_id: null }), { kind: 'preview' })).toMatchObject({ ok: false, error: 'no_draft' })
    expect(await sendLink.run(ctx({ status: 'published' }), { kind: 'preview' })).toMatchObject({ ok: false, error: 'already_published' })
    expect(h.send).not.toHaveBeenCalled()
  })

  it('live: needs a published site and sends the live address', async () => {
    expect(await sendLink.run(ctx(), { kind: 'live' })).toMatchObject({ ok: false, error: 'not_published' })
    const r = await sendLink.run(ctx({ status: 'published' }), { kind: 'live' })
    expect(r.ok).toBe(true)
    expect(h.send.mock.calls[0][1]).toMatchObject({ template: 'site_live' })
    expect(h.send.mock.calls[0][1].url).toContain('ravi-stores')
  })

  it('claim: the token URL goes only into the template, never into the reply', async () => {
    h.createClaimToken.mockResolvedValue({ token: 'TOK', expiresAt: 'x', url: 'https://ecom.example/claim/TOK' })
    const r = await sendLink.run(ctx({ status: 'published' }), { kind: 'claim' })
    expect(h.send.mock.calls[0][1]).toMatchObject({ template: 'claim', url: 'https://ecom.example/claim/TOK' })
    expect(JSON.stringify(r)).not.toContain('TOK')
    expect(r.data).toEqual({ sent: true, kind: 'claim', mode: 'captured' })
    expect(await sendLink.run(ctx({ status: 'claimed' }), { kind: 'claim' })).toMatchObject({ ok: false, error: 'already_claimed' })
  })

  it('a quota refusal sends nothing; a failed send reports the reason', async () => {
    h.sendQuota.mockResolvedValueOnce('template_limit')
    expect(await sendLink.run(ctx(), { kind: 'preview' })).toMatchObject({ ok: false, error: 'template_limit' })
    expect(h.send).not.toHaveBeenCalled()
    h.send.mockResolvedValueOnce({ ok: false, reason: 'no_consent' })
    expect(await sendLink.run(ctx(), { kind: 'preview' })).toMatchObject({ ok: false, error: 'no_consent' })
  })
})

describe('sendWhatsAppTemplate', () => {
  it('details_needed defaults the missing list from the brief and links the preview', async () => {
    const extra = { brief: { whatTheyDo: 'sarees', audience: 'women', highlights: ['silk'], contact: { phone: '1' }, hours: '9-9', address: 'x' } }
    await sendWhatsAppTemplate.run(ctx({ extra }), { template: 'details_needed' })
    expect(h.send.mock.calls[0][1]).toMatchObject({ template: 'details_needed', missing: ['style'], url: 'https://site-x/preview?t=fresh' })
    await sendWhatsAppTemplate.run(ctx({ extra }), { template: 'details_needed', missing: ['hours'] })
    expect(h.send.mock.calls[1][1].missing).toEqual(['hours'])
  })

  it('links the live site once published', async () => {
    await sendWhatsAppTemplate.run(ctx({ status: 'published' }), { template: 'details_needed' })
    expect(h.startDraft).not.toHaveBeenCalled()
    expect(h.send.mock.calls[0][1].url).toContain('ravi-stores')
  })

  it('callback uses the next pending call task, else refuses', async () => {
    expect(await sendWhatsAppTemplate.run(ctx(), { template: 'callback' })).toMatchObject({ ok: false, error: 'no_callback' })
    h.query.mockImplementation(async (sql: string) => (sql.includes('outreach_agent_tasks') ? { rows: [{ due_at: '2026-11-28T05:00:00Z' }] } : { rows: [] }))
    await sendWhatsAppTemplate.run(ctx(), { template: 'callback' })
    expect(h.send.mock.calls[0][1].callbackAt).toEqual(new Date('2026-11-28T05:00:00Z'))
  })

  it('trial_ending needs a known trial end', async () => {
    await sendWhatsAppTemplate.run(ctx({ status: 'published' }), { template: 'trial_ending' })
    expect(h.send.mock.calls[0][1].trialEndsAt).toEqual(new Date('2026-12-04T00:00:00Z'))
    h.getShowcaseById.mockResolvedValue({ slug: 'r', trialEndsAt: null })
    expect(await sendWhatsAppTemplate.run(ctx({ status: 'published' }), { template: 'trial_ending' })).toMatchObject({ ok: false, error: 'no_trial' })
  })

  it('refuses over the template quota, and with no site to link', async () => {
    h.sendQuota.mockResolvedValueOnce('template_limit')
    expect(await sendWhatsAppTemplate.run(ctx(), { template: 'details_needed' })).toMatchObject({ error: 'template_limit' })
    expect(await sendWhatsAppTemplate.run(ctx({ showcase_site_id: null }), { template: 'details_needed' })).toMatchObject({ error: 'no_site' })
  })
})

describe('sendWhatsAppText', () => {
  it('checks the text quota and sends through sendOutreachText', async () => {
    const r = await sendWhatsAppText.run(ctx(), { text: 'Your site is ready to look at.' })
    expect(h.sendQuota).toHaveBeenCalledWith('k1', 'text', HARD_LIMITS, NOW)
    expect(h.sendText).toHaveBeenCalledWith('k1', 'Your site is ready to look at.', { actor: 'outreach:agent' }, NOW)
    expect(r).toMatchObject({ ok: true, data: { sent: true, mode: 'captured' } })
  })

  it('reports the window / consent refusal code, and the text quota', async () => {
    h.sendText.mockResolvedValueOnce({ ok: false, reason: 'window_closed' })
    expect(await sendWhatsAppText.run(ctx(), { text: 'hi' })).toMatchObject({ ok: false, error: 'window_closed' })
    h.sendQuota.mockResolvedValueOnce('text_limit')
    expect(await sendWhatsAppText.run(ctx(), { text: 'hi' })).toMatchObject({ ok: false, error: 'text_limit' })
  })

  it('never sends a message that claims to be human', async () => {
    const r = await sendWhatsAppText.run(ctx(), { text: "I'm a real person, not a bot" })
    expect(r).toMatchObject({ ok: false, error: 'denies_ai' })
    expect(h.sendText).not.toHaveBeenCalled()
  })
})

describe('readMessages', () => {
  it('returns the last messages oldest first with claim links masked', async () => {
    h.query.mockResolvedValueOnce({
      rows: [
        { direction: 'out', template_slug: 'outreach/claim', body: '[outreach/claim] → https://ecom.example/claim/abc.def_123', created_at: '2026-11-27T05:59:00Z' },
        { direction: 'in', template_slug: null, body: 'thanks', created_at: '2026-11-27T05:58:00Z' },
      ],
    })
    const r = await readMessages.run(ctx(), { limit: 5 })
    expect(h.query.mock.calls[0][1]).toEqual(['k1', 5])
    const m = (r.data as { messages: { direction: string; body: string; template: string | null }[] }).messages
    expect(m.map(x => x.direction)).toEqual(['in', 'out'])
    expect(m[1].body).toBe('[outreach/claim] → [claim link]')
    expect(JSON.stringify(r)).not.toContain('abc.def')
  })

  it('defaults to 10 messages', async () => {
    await readMessages.run(ctx(), {})
    expect(h.query.mock.calls[0][1]).toEqual(['k1', 10])
  })
})

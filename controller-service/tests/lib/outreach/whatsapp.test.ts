import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeDb, CONTACT, type FakeDb } from './wa-fake-db'

const h = vi.hoisted(() => ({ db: null as any, sendByTemplate: vi.fn(), sendWhatsAppDirect: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => h.db.pool }))
vi.mock('@/lib/shared/send-by-template', () => ({ sendByTemplate: h.sendByTemplate }))
vi.mock('@/lib/shared/whatsapp', () => ({ sendWhatsAppDirect: h.sendWhatsAppDirect }))

import {
  captureMode, missingText, readCapturedWhatsApp, recordInbound, sendOutreachTemplate, sendOutreachText, templateSlug, templateVariables, windowOpen,
} from '@controller/lib/outreach/whatsapp'

let db: FakeDb
const NOW = new Date('2026-11-24T06:00:00Z')
const kinds = () => db.events.map(e => e.kind)

beforeEach(() => {
  vi.clearAllMocks()
  db = fakeDb()
  h.db = db
  db.contact = { ...CONTACT }
  vi.stubEnv('OUTREACH_TEST_MODE', '1')
})
afterEach(() => vi.unstubAllEnvs())

describe('captureMode', () => {
  it('OUTREACH_TEST_MODE wins; unset, only production sends', () => {
    expect(captureMode({ OUTREACH_TEST_MODE: 'true', NODE_ENV: 'production' } as any)).toBe(true)
    expect(captureMode({ OUTREACH_TEST_MODE: 'off', NODE_ENV: 'development' } as any)).toBe(false)
    expect(captureMode({ NODE_ENV: 'production' } as any)).toBe(false)
    expect(captureMode({ NODE_ENV: 'test' } as any)).toBe(true)
    expect(captureMode({} as any)).toBe(true)
  })
})

describe('template slugs and variables', () => {
  it('uses the Hindi copy only for Hindi contacts', () => {
    expect(templateSlug('preview_ready', 'hi')).toBe('outreach/preview_ready_hi')
    expect(templateSlug('preview_ready', 'ta')).toBe('outreach/preview_ready')
    expect(templateSlug('claim', null)).toBe('outreach/claim')
  })

  it('numbers owner, business and the template detail as the catalog does', () => {
    const c = { owner_name: null, business_name: ' Sharma Sweets ', language: 'en' } as any
    expect(templateVariables(c, { template: 'site_live', url: 'https://x' })).toEqual({ '1': 'there', '2': 'Sharma Sweets' })
    expect(templateVariables({ ...c, language: 'hi' }, { template: 'site_live', url: 'https://x' })['1']).toBe('जी')
    expect(templateVariables(c, { template: 'details_needed', url: 'https://x', missing: ['hours', 'address'] })['3']).toBe('your opening hours and your address')
    expect(templateVariables(c, { template: 'callback', url: 'https://x', callbackAt: new Date('2026-11-25T05:30:00Z') })['3']).toMatch(/25 Nov.*11:00/)
    expect(templateVariables(c, { template: 'trial_ending', url: 'https://x', trialEndsAt: '1 December' })['3']).toBe('1 December')
  })

  it('lists missing details in plain words', () => {
    expect(missingText(['whatTheyDo', 'hours', 'contact'], 'en')).toBe('what your business does, your opening hours and a phone number or email for customers')
    expect(missingText(['hours', 'address'], 'hi')).toBe('खुलने का समय और आपका पता')
    expect(missingText([], 'en')).toBe('a few more details')
  })
})

describe('sendOutreachTemplate', () => {
  const input = { template: 'preview_ready' as const, url: 'https://site-sharma.jeffistores.in/preview?t=abc' }

  it('refuses without recorded WhatsApp consent, and audits the refusal', async () => {
    db.contact!.consent_whatsapp_at = null
    expect(await sendOutreachTemplate(CONTACT.id, input)).toEqual({ ok: false, reason: 'no_consent' })
    expect(h.sendByTemplate).not.toHaveBeenCalled()
    expect(db.messages).toEqual([])
    expect(db.events[0]).toMatchObject({ kind: 'whatsapp_refused', data: { reason: 'no_consent', template: 'preview_ready' } })
  })

  it('refuses an opted-out, suppressed or unknown contact and a bad link', async () => {
    db.contact!.opted_out_at = NOW.toISOString()
    expect(await sendOutreachTemplate(CONTACT.id, input)).toMatchObject({ reason: 'opted_out' })
    db.contact!.opted_out_at = null
    db.suppressed.add(CONTACT.phone)
    expect(await sendOutreachTemplate(CONTACT.id, input)).toMatchObject({ reason: 'suppressed' })
    db.suppressed.clear()
    expect(await sendOutreachTemplate(CONTACT.id, { ...input, url: 'javascript:alert(1)' })).toMatchObject({ reason: 'invalid_input' })
    expect(await sendOutreachTemplate('22222222-2222-4222-8222-222222222222', input)).toMatchObject({ reason: 'not_found' })
    expect(h.sendByTemplate).not.toHaveBeenCalled()
  })

  it('captures instead of sending in test mode, and the harness can read it back', async () => {
    const out = await sendOutreachTemplate(CONTACT.id, { ...input, callId: 'call-1' })
    expect(out).toEqual({ ok: true, mode: 'captured', messageId: 'm1', providerMessageId: null })
    expect(h.sendByTemplate).not.toHaveBeenCalled()
    expect(db.messages[0]).toMatchObject({ direction: 'out', template_slug: 'outreach/preview_ready', status: 'captured' })
    expect(db.events[0]).toMatchObject({ kind: 'whatsapp_out', data: { mode: 'captured', button_url: input.url, variables: { '1': 'Ravi', '2': 'Sharma Sweets' } } })
    const captured = await readCapturedWhatsApp({ contactId: CONTACT.id })
    expect(captured).toEqual([
      expect.objectContaining({ messageId: 'm1', contactId: CONTACT.id, to: CONTACT.phone, kind: 'template', template: 'preview_ready', slug: 'outreach/preview_ready', buttonUrl: input.url }),
    ])
  })

  it('sends as the platform from the customer number with the link button outside test mode', async () => {
    vi.stubEnv('OUTREACH_TEST_MODE', '0')
    db.contact!.language = 'hi'
    h.sendByTemplate.mockResolvedValue({ status: 'sent', providerSid: 'wamid.9', body: 'नमस्ते Ravi…' })
    const out = await sendOutreachTemplate(CONTACT.id, input)
    expect(out).toEqual({ ok: true, mode: 'sent', messageId: 'm1', providerMessageId: 'wamid.9' })
    expect(h.sendByTemplate).toHaveBeenCalledWith({
      channel: 'whatsapp', slug: 'outreach/preview_ready_hi', to: CONTACT.phone, variables: { '1': 'Ravi', '2': 'Sharma Sweets' }, buttonUrl: input.url,
      asPlatform: true, audience: 'customer', reference: `outreach:${CONTACT.id}`,
    })
    expect(db.messages[0]).toMatchObject({ provider_message_id: 'wamid.9', status: 'sent', body: 'नमस्ते Ravi…' })
  })

  it('records a failed send', async () => {
    vi.stubEnv('OUTREACH_TEST_MODE', '0')
    h.sendByTemplate.mockResolvedValue({ status: 'failed', error: 'template not approved' })
    expect(await sendOutreachTemplate(CONTACT.id, input)).toEqual({ ok: false, reason: 'failed', error: 'template not approved', messageId: 'm1' })
    expect(db.messages[0].status).toBe('failed')
    expect(db.events[0].data).toMatchObject({ mode: 'sent', status: 'failed', error: 'template not approved' })
  })
})

describe('sendOutreachText and the 24h window', () => {
  it('refuses free text once the window has closed', async () => {
    db.contact!.wa_window_expires_at = new Date(NOW.getTime() - 1000).toISOString()
    expect(await sendOutreachText(CONTACT.id, 'Hello', {}, NOW)).toEqual({ ok: false, reason: 'window_closed' })
    expect(kinds()).toEqual(['whatsapp_refused'])
  })

  it('sends inside the window (captured in test mode, direct otherwise)', async () => {
    db.contact!.wa_window_expires_at = new Date(NOW.getTime() + 3600_000).toISOString()
    expect(await sendOutreachText(CONTACT.id, 'Got it, thanks!', {}, NOW)).toMatchObject({ ok: true, mode: 'captured' })
    vi.stubEnv('OUTREACH_TEST_MODE', '0')
    h.sendWhatsAppDirect.mockResolvedValue('SM5')
    expect(await sendOutreachText(CONTACT.id, 'Done', {}, NOW)).toMatchObject({ ok: true, mode: 'sent', providerMessageId: 'SM5' })
    expect(h.sendWhatsAppDirect).toHaveBeenCalledWith({ phone: CONTACT.phone, text: 'Done', kind: 'outreach', audience: 'customer' })
    expect(db.messages.map(m => m.status)).toEqual(['captured', 'sent'])
  })

  it('the opt-out confirmation skips the consent and opt-out checks but not the window', async () => {
    Object.assign(db.contact!, { consent_whatsapp_at: null, opted_out_at: NOW.toISOString(), status: 'opted_out' })
    db.contact!.wa_window_expires_at = new Date(NOW.getTime() + 60_000).toISOString()
    expect(await sendOutreachText(CONTACT.id, 'Done.', { optOutConfirmation: true }, NOW)).toMatchObject({ ok: true })
    expect(await sendOutreachText(CONTACT.id, 'One more thing', {}, NOW)).toMatchObject({ ok: false, reason: 'opted_out' })
    db.contact!.wa_window_expires_at = null
    expect(await sendOutreachText(CONTACT.id, 'Done.', { optOutConfirmation: true }, NOW)).toMatchObject({ ok: false, reason: 'window_closed' })
  })
})

describe('recordInbound', () => {
  it('stores the message and opens the window for 24h from it', async () => {
    const at = new Date('2026-11-24T06:00:00Z')
    const r = await recordInbound(CONTACT, { text: ' our hours are 9 to 9 ', providerMessageId: 'wamid.1', receivedAt: at, hasMedia: true })
    expect(r).toEqual({ messageId: 'm1', windowExpiresAt: new Date('2026-11-25T06:00:00Z') })
    expect(db.messages[0]).toMatchObject({ direction: 'in', body: 'our hours are 9 to 9\n[attachment]', provider_message_id: 'wamid.1' })
    expect(windowOpen(db.contact as any, new Date('2026-11-25T05:59:00Z'))).toBe(true)
    expect(windowOpen(db.contact as any, new Date('2026-11-25T06:01:00Z'))).toBe(false)
    expect(kinds()).toEqual(['whatsapp_in'])
  })

  it('skips a provider message it already stored', async () => {
    await recordInbound(CONTACT, { text: 'hi', providerMessageId: 'wamid.1' })
    expect(await recordInbound(CONTACT, { text: 'hi', providerMessageId: 'wamid.1' })).toBeNull()
    expect(db.messages).toHaveLength(1)
  })

  it('never moves the window back for a late delivery', async () => {
    await recordInbound(CONTACT, { text: 'b', providerMessageId: 'w2', receivedAt: new Date('2026-11-24T08:00:00Z') })
    await recordInbound(CONTACT, { text: 'a', providerMessageId: 'w1', receivedAt: new Date('2026-11-24T07:00:00Z') })
    expect(new Date(db.contact!.wa_window_expires_at).toISOString()).toBe('2026-11-25T08:00:00.000Z')
  })
})

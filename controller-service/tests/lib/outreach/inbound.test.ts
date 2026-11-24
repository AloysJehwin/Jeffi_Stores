// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeDb, CONTACT, type FakeDb } from './wa-fake-db'

const h = vi.hoisted(() => ({
  db: null as any,
  aiChat: vi.fn(),
  markRead: vi.fn(),
  mergeBrief: vi.fn(),
  requestChange: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => h.db.pool }))
vi.mock('@/lib/shared/ai-client', () => ({ aiChat: h.aiChat }))
vi.mock('@/lib/shared/whatsapp', () => ({ markWhatsAppRead: h.markRead, sendWhatsAppDirect: vi.fn() }))
vi.mock('@/lib/shared/send-by-template', () => ({ sendByTemplate: vi.fn() }))
vi.mock('@/lib/support/translate', () => ({
  detectLang: (t: string, fallback?: string | null) => (/[ऀ-ॿ]/.test(t) ? 'hi' : /[஀-௿]/.test(t) ? 'ta' : fallback ?? 'en'),
}))
vi.mock('@controller/lib/outreach/build', () => ({ mergeBrief: h.mergeBrief, requestChange: h.requestChange }))

import { briefFromArgs, handleOutreachInbound, isOptOut, OPT_OUT_CONFIRMATION, replyLanguage, routeOutreachWhatsApp } from '@controller/lib/outreach/inbound'

let db: FakeDb
const msg = (text: string, id = 'wamid.1') => ({ from: 'whatsapp:+919876543210', text, providerMessageId: id, receivedAt: new Date() })
const out = () => db.messages.filter(m => m.direction === 'out')
const kinds = () => db.events.map(e => e.kind)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db = fakeDb()
  h.db = db
  db.contact = { ...CONTACT }
  vi.stubEnv('OUTREACH_TEST_MODE', '1')
})
afterEach(() => vi.unstubAllEnvs())

describe('isOptOut', () => {
  it.each([
    'STOP', 'stop.', ' Stop 🙏', 'unsubscribe', 'Please unsubscribe me', "Don’t message me again", 'do not contact me', 'opt out',
    'बंद करो', 'मुझे मैसेज मत भेजो', 'band karo', 'bhai message mat karo', 'pareshan mat karo',
    'நிறுத்து', 'எனக்கு செய்தி அனுப்ப வேண்டாம்', 'ఆపండి', 'దయచేసి మెసేజ్‌లు పంపవద్దు', 'ನಿಲ್ಲಿಸಿ', 'ದಯವಿಟ್ಟು ಮೆಸೇಜ್ ಮಾಡಬೇಡಿ',
    'നിർത്തുക', 'ദയവായി മെസ്സേജ് അയക്കരുത്', 'थांबवा', 'मला मेसेज करू नका', 'বন্ধ করুন', 'আমাকে মেসেজ করবেন না', 'બંધ કરો', 'મને મેસેજ ન કરો',
  ])('%s opts out', text => expect(isOptOut(text)).toBe(true))

  it.each(['We stop selling at 9 pm', 'our shop is closed on Sunday', 'दुकान रविवार को बंद रहती है', 'Send the photos please', 'one stop shop', ''])(
    '%s does not',
    text => expect(isOptOut(text)).toBe(false)
  )
})

describe('replyLanguage', () => {
  it("answers in the message's language, else the contact's", () => {
    expect(replyLanguage({ language: 'en' }, 'हमारी दुकान 9 बजे खुलती है')).toBe('hi')
    expect(replyLanguage({ language: 'ta' }, 'ok thanks')).toBe('ta')
    expect(replyLanguage({ language: null }, 'ok')).toBe('en')
  })
})

describe('routeOutreachWhatsApp', () => {
  it('lets a number with no active outreach contact go on to the usual routing', async () => {
    db.contact = null
    expect(await routeOutreachWhatsApp(msg('hi'))).toBe(false)
    expect(db.messages).toEqual([])
  })

  it('lets the message through when the lookup itself fails', async () => {
    h.db = { pool: { query: vi.fn().mockRejectedValue(new Error('db down')) } }
    expect(await routeOutreachWhatsApp(msg('hi'))).toBe(false)
  })

  it('keeps a matched contact even when handling fails, and audits the failure', async () => {
    h.aiChat.mockRejectedValue(new Error('gateway down'))
    db.query.mockImplementationOnce(async () => ({ rows: [db.contact] })).mockImplementationOnce(async () => {
      throw new Error('insert failed')
    })
    expect(await routeOutreachWhatsApp(msg('hi'))).toBe(true)
    expect(kinds()).toEqual(['whatsapp_inbound_failed'])
  })

  it('stores the message, opens the 24h window and answers (captured in test mode)', async () => {
    h.aiChat.mockResolvedValue({ content: 'Thanks Ravi! What are your opening hours?' })
    expect(await routeOutreachWhatsApp(msg('Hi, I got the link'))).toBe(true)
    expect(db.messages.map(m => m.direction)).toEqual(['in', 'out'])
    expect(out()[0]).toMatchObject({ body: 'Thanks Ravi! What are your opening hours?', status: 'captured' })
    expect(new Date(db.contact!.wa_window_expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000)
    expect(h.markRead).not.toHaveBeenCalled()
  })
})

describe('opt-out', () => {
  it('STOP opts out at once: status, suppression and one confirmation, with no model turn', async () => {
    const r = await handleOutreachInbound(db.contact as any, msg('STOP'))
    expect(r).toEqual({ action: 'opted_out', confirmed: true })
    expect(db.contact!.status).toBe('opted_out')
    expect(db.contact!.opted_out_at).toBeInstanceOf(Date)
    expect(db.suppressed.has(CONTACT.phone)).toBe(true)
    expect(out().map(m => m.body)).toEqual([OPT_OUT_CONFIRMATION.en])
    expect(kinds()).toEqual(['whatsapp_in', 'status_change', 'suppression_added', 'whatsapp_out'])
    expect(h.aiChat).not.toHaveBeenCalled()
  })

  it('confirms in the language they wrote in', async () => {
    await handleOutreachInbound(db.contact as any, msg('मुझे मैसेज मत भेजो'))
    expect(out().map(m => m.body)).toEqual([OPT_OUT_CONFIRMATION.hi])
  })

  it('confirms only once', async () => {
    await handleOutreachInbound(db.contact as any, msg('STOP', 'w1'))
    expect(await handleOutreachInbound(db.contact as any, msg('stop', 'w2'))).toEqual({ action: 'opted_out', confirmed: false })
    expect(out()).toHaveLength(1)
  })

  it('honours an opt-out the assistant recognised', async () => {
    h.aiChat.mockResolvedValue({ content: '', toolCalls: [{ id: 't1', name: 'opt_out', arguments: {} }] })
    expect(await handleOutreachInbound(db.contact as any, msg('please leave me alone now'))).toEqual({ action: 'opted_out', confirmed: true })
    expect(db.contact!.status).toBe('opted_out')
    expect(h.mergeBrief).not.toHaveBeenCalled()
  })

  it('ignores a provider message it has already handled', async () => {
    await handleOutreachInbound(db.contact as any, msg('STOP'))
    expect(await handleOutreachInbound(db.contact as any, msg('STOP'))).toEqual({ action: 'duplicate' })
  })
})

describe('slot filling', () => {
  it('merges the details into the brief and replies with what the model wrote after the tool result', async () => {
    h.mergeBrief.mockResolvedValue({ building: true, missing: ['address'] })
    h.aiChat
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 't1', name: 'update_details', arguments: { hours: '9 am to 9 pm', highlights: ['Pure ghee', ''], contact: { phone: '98765 43210', email: '' } } }], providerState: { provider: 'anthropic', content: [] } })
      .mockResolvedValueOnce({ content: 'Got it! And where is your shop?' })
    const r = await handleOutreachInbound(db.contact as any, msg('We are open 9 am to 9 pm, everything in pure ghee'))
    expect(r).toEqual({ action: 'replied', reply: 'Got it! And where is your shop?', tools: ['update_details'] })
    expect(h.mergeBrief).toHaveBeenCalledWith(CONTACT.id, { hours: '9 am to 9 pm', highlights: ['Pure ghee'], contact: { phone: '98765 43210' } })
    const second = h.aiChat.mock.calls[1][0]
    expect(second.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 't1', content: JSON.stringify({ building: true, missing: ['address'] }) })
    expect(second.messages.at(-2)).toMatchObject({ role: 'assistant', providerState: { provider: 'anthropic' } })
    expect(h.aiChat.mock.calls[0][0]).toMatchObject({ feature: 'outreach_whatsapp', cacheNamespace: 'platform' })
    expect(h.aiChat.mock.calls[0][0].messages[0].content).toContain('Sharma Sweets')
    expect(kinds()).toContain('brief_updated')
  })

  it('asks build.ts for a change', async () => {
    h.requestChange.mockResolvedValue({ ok: true, summary: 'Hero photo replaced' })
    h.aiChat
      .mockResolvedValueOnce({ content: '', toolCalls: [{ name: 'request_change', arguments: { instruction: 'Use a red colour theme' } }] })
      .mockResolvedValueOnce({ content: 'Done, the site is red now.' })
    await handleOutreachInbound(db.contact as any, msg('make it red'))
    expect(h.requestChange).toHaveBeenCalledWith(CONTACT.id, 'Use a red colour theme')
    expect(db.events.find(e => e.kind === 'change_requested')?.data).toMatchObject({ ok: true, instruction: 'Use a red colour theme' })
  })

  it('passes a tool failure back to the model instead of failing the turn', async () => {
    h.mergeBrief.mockRejectedValue(new Error('site not found'))
    h.aiChat
      .mockResolvedValueOnce({ content: '', toolCalls: [{ name: 'update_details', arguments: { address: 'MI Road' } }] })
      .mockResolvedValueOnce({ content: 'Thanks, noted.' })
    expect(await handleOutreachInbound(db.contact as any, msg('MI Road, Jaipur'))).toMatchObject({ action: 'replied' })
    expect(h.aiChat.mock.calls[1][0].messages.at(-1).content).toContain('site not found')
  })

  it('sends a short fallback when the model is unreachable', async () => {
    h.aiChat.mockRejectedValue(new Error('gateway down'))
    db.contact!.language = 'hi'
    const r = await handleOutreachInbound(db.contact as any, msg('hello'))
    expect(r).toMatchObject({ action: 'fallback' })
    expect(out()[0].body).toContain('धन्यवाद')
    expect(kinds()).toContain('whatsapp_assistant_failed')
  })

  it('marks the message read outside test mode', async () => {
    vi.stubEnv('OUTREACH_TEST_MODE', '0')
    h.aiChat.mockResolvedValue({ content: '' })
    expect(await handleOutreachInbound(db.contact as any, msg('ok'))).toEqual({ action: 'no_reply', tools: [] })
    expect(h.markRead).toHaveBeenCalledWith('wamid.1', 'customer')
  })
})

describe('briefFromArgs', () => {
  it('maps the tool arguments onto the brief and drops empties', () => {
    expect(briefFromArgs({ what_they_do: ' Sweets ', audience: '', language: 'hi', style: 7, contact: { email: '' } })).toEqual({ whatTheyDo: 'Sweets', language: 'hi' })
    expect(briefFromArgs({ language: 'fr' })).toEqual({})
  })
})

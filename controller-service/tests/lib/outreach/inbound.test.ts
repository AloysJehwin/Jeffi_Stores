// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeDb, CONTACT, type FakeDb } from './wa-fake-db'

const h = vi.hoisted(() => ({
  db: null as any,
  runAgentTurn: vi.fn(),
  markRead: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => h.db.pool }))
vi.mock('@controller/lib/outreach/agent/runtime', () => ({ runAgentTurn: h.runAgentTurn }))
vi.mock('@/lib/shared/whatsapp', () => ({ markWhatsAppRead: h.markRead, sendWhatsAppDirect: vi.fn() }))
vi.mock('@/lib/shared/send-by-template', () => ({ sendByTemplate: vi.fn() }))
vi.mock('@/lib/support/translate', () => ({
  detectLang: (t: string, fallback?: string | null) => (/[ऀ-ॿ]/.test(t) ? 'hi' : /[஀-௿]/.test(t) ? 'ta' : fallback ?? 'en'),
}))

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
  h.runAgentTurn.mockResolvedValue({ action: 'no_reply', tools: [] })
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
    db.query.mockImplementationOnce(async () => ({ rows: [db.contact] })).mockImplementationOnce(async () => {
      throw new Error('insert failed')
    })
    expect(await routeOutreachWhatsApp(msg('hi'))).toBe(true)
    expect(kinds()).toEqual(['whatsapp_inbound_failed'])
  })

  it('stores the message, opens the 24h window and hands the turn to the agent', async () => {
    h.runAgentTurn.mockResolvedValue({ action: 'replied', reply: 'Thanks Ravi!', tools: [] })
    expect(await routeOutreachWhatsApp(msg('Hi, I got the link'))).toBe(true)
    expect(db.messages.map(m => m.direction)).toEqual(['in'])
    expect(h.runAgentTurn).toHaveBeenCalledWith({ contact: db.contact, channel: 'whatsapp', trigger: { kind: 'inbound', messageId: 'm1' }, language: 'en' })
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
    expect(h.runAgentTurn).not.toHaveBeenCalled()
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

  it('reports an opt-out the agent handled through its optOut tool', async () => {
    h.runAgentTurn.mockResolvedValue({ action: 'opted_out', tools: ['optOut'], confirmed: true })
    expect(await handleOutreachInbound(db.contact as any, msg('please leave me alone now'))).toEqual({ action: 'opted_out', confirmed: true })
    h.runAgentTurn.mockResolvedValue({ action: 'opted_out', tools: [] })
    expect(await handleOutreachInbound(db.contact as any, msg('leave me alone', 'w2'))).toEqual({ action: 'opted_out', confirmed: false })
  })

  it('ignores a provider message it has already handled', async () => {
    await handleOutreachInbound(db.contact as any, msg('STOP'))
    expect(await handleOutreachInbound(db.contact as any, msg('STOP'))).toEqual({ action: 'duplicate' })
  })
})

describe('the agent turn', () => {
  it('passes the reply language the message was written in', async () => {
    await handleOutreachInbound(db.contact as any, msg('हमारी दुकान 9 बजे खुलती है'))
    expect(h.runAgentTurn.mock.calls[0][0]).toMatchObject({ language: 'hi', channel: 'whatsapp' })
  })

  it('returns what the agent did: replied, paused (handed off) or budget (handed off by the cap)', async () => {
    h.runAgentTurn.mockResolvedValueOnce({ action: 'replied', reply: 'Got it!', tools: ['addDetails'] })
    expect(await handleOutreachInbound(db.contact as any, msg('9 to 9', 'w1'))).toEqual({ action: 'replied', reply: 'Got it!', tools: ['addDetails'] })
    h.runAgentTurn.mockResolvedValueOnce({ action: 'paused', tools: [] })
    expect(await handleOutreachInbound(db.contact as any, msg('hello?', 'w2'))).toEqual({ action: 'paused', tools: [] })
    h.runAgentTurn.mockResolvedValueOnce({ action: 'budget', tools: [] })
    expect(await handleOutreachInbound(db.contact as any, msg('again', 'w3'))).toEqual({ action: 'budget', tools: [] })
  })

  it('a failing turn is audited and the message still stays out of the shopper bot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.runAgentTurn.mockRejectedValue(new Error('runtime down'))
    expect(await routeOutreachWhatsApp(msg('hello'))).toBe(true)
    expect(kinds()).toEqual(['whatsapp_in', 'whatsapp_inbound_failed'])
  })

  it('marks the message read outside test mode', async () => {
    vi.stubEnv('OUTREACH_TEST_MODE', '0')
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

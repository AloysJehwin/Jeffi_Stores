import 'server-only'
import twilio from 'twilio'

// Numbers the platform buys for a store, in its own Twilio account: search, buy (incoming webhook = the platform's
// Twilio webhook), register the number as a WhatsApp sender on the platform's WhatsApp Business account, read its
// status, release. Real only in production; local dev and tests get a fake that never calls Twilio or spends money.

export interface AvailableNumber {
  number: string
  locality: string | null
  region: string | null
}

export interface NumberProvider {
  live: boolean
  search(o: { country: string; areaCode?: string; limit?: number }): Promise<AvailableNumber[]>
  monthlyPriceUsd(country: string): Promise<number | null>
  buy(number: string, friendlyName: string): Promise<{ sid: string; number: string }>
  registerWhatsApp(number: string, displayName: string): Promise<{ sid: string; status: string }>
  whatsAppStatus(senderSid: string): Promise<{ status: string; reason: string | null }>
  release(numberSid: string | null, senderSid: string | null): Promise<void>
}

const webhookUrl = () => process.env.TWILIO_WEBHOOK_URL || `${(process.env.PUBLIC_WEBHOOK_BASE_URL || 'https://jeffistores.in').replace(/\/$/, '')}/api/webhooks/twilio`

function twilioProvider(): NumberProvider {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('Twilio is not configured on the platform (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
  const c = twilio(sid, token)
  let waba: string | null = process.env.TWILIO_WABA_ID || null

  // The platform's WhatsApp Business account: the one its own WhatsApp number (TWILIO_WHATSAPP_FROM) is on.
  async function wabaId(): Promise<string> {
    if (waba) return waba
    const own = `whatsapp:${(process.env.TWILIO_WHATSAPP_FROM || '').replace(/^whatsapp:/, '')}`
    const list = await c.messaging.v2.channelsSenders.list({ channel: 'whatsapp', limit: 50 })
    const s = list.find(x => x.senderId === own)
    if (!s) throw new Error('The platform WhatsApp sender was not found in Twilio; set TWILIO_WABA_ID')
    const full = await c.messaging.v2.channelsSenders(s.sid).fetch()
    waba = (full.configuration as any)?.wabaId ?? null
    if (!waba) throw new Error('Could not read the platform WhatsApp Business account id; set TWILIO_WABA_ID')
    return waba
  }

  return {
    live: true,
    async search({ country, areaCode, limit = 10 }) {
      const found = await c.availablePhoneNumbers(country).local.list({
        smsEnabled: true,
        voiceEnabled: true,
        ...(areaCode ? { areaCode: Number(areaCode) } : {}),
        limit,
      })
      return found.map(n => ({ number: n.phoneNumber, locality: n.locality || null, region: n.region || null }))
    },
    async monthlyPriceUsd(country) {
      const p = await c.pricing.v1.phoneNumbers.countries(country).fetch().catch(() => null)
      const local = p?.phoneNumberPrices?.find((x: any) => x.numberType === 'local') as any
      return local ? Number(local.currentPrice) : null
    },
    async buy(number, friendlyName) {
      const n = await c.incomingPhoneNumbers.create({ phoneNumber: number, friendlyName: friendlyName.slice(0, 64), smsUrl: webhookUrl(), smsMethod: 'POST' })
      return { sid: n.sid, number: n.phoneNumber }
    },
    async registerWhatsApp(number, displayName) {
      // Senders API v2 takes the JSON body as-is (snake_case).
      const s = await c.messaging.v2.channelsSenders.create({
        sender_id: `whatsapp:${number}`,
        configuration: { waba_id: await wabaId(), verification_method: 'sms' },
        webhook: { callback_url: webhookUrl(), callback_method: 'POST' },
        profile: { name: displayName.slice(0, 100) },
      } as any)
      return { sid: s.sid, status: s.status }
    },
    async whatsAppStatus(senderSid) {
      const s = await c.messaging.v2.channelsSenders(senderSid).fetch()
      const r = (s.offlineReasons as any[] | null)?.find(x => x?.message)
      return { status: s.status, reason: r ? `${r.message}${r.code ? ` (${r.code})` : ''}` : null }
    },
    async release(numberSid, senderSid) {
      if (senderSid) await c.messaging.v2.channelsSenders(senderSid).remove().catch(e => { if (e?.status !== 404) throw e })
      if (numberSid) await c.incomingPhoneNumbers(numberSid).remove().catch(e => { if (e?.status !== 404) throw e })
    },
  }
}

// Fake: numbers +1 555 01xx; a WhatsApp sender goes ONLINE 20 seconds after it was registered (time in its sid).
function fakeProvider(): NumberProvider {
  return {
    live: false,
    async search({ limit = 6 }) {
      return Array.from({ length: limit }, (_, i) => ({ number: `+1555010${String(10 + i * 7).padStart(4, '0').slice(-4)}`, locality: 'Test City', region: 'XX' }))
    },
    async monthlyPriceUsd() {
      return 1.15
    },
    async buy(number) {
      return { sid: `PNfake${Date.now().toString(36)}`, number }
    },
    async registerWhatsApp() {
      return { sid: `XEfake${Date.now()}`, status: 'CREATING' }
    },
    async whatsAppStatus(senderSid) {
      const at = Number(senderSid.replace('XEfake', '')) || 0
      return { status: Date.now() - at > 20_000 ? 'ONLINE' : 'CREATING', reason: null }
    },
    async release() {},
  }
}

export function numberProvider(): NumberProvider {
  return process.env.NODE_ENV === 'production' && !process.env.VITEST && process.env.NUMBERS_FAKE !== 'true' ? twilioProvider() : fakeProvider()
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// In-memory stand-in for the messages table + mocked wallet/providers.
const rows = new Map<string, any>()
const senderRows = new Map<string, any>() // `${tenant}:${channel}` → a tenant_messaging_senders row, or several
vi.mock('../src/db.js', () => ({
  db: {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.startsWith('SELECT audience, provider, sender, config_enc FROM tenant_messaging_senders')) {
        const all = [senderRows.get(`${params[0]}:${params[1]}`) ?? []].flat()
        const r = all.find(x => x.audience === params[2]) ?? all.find(x => x.audience === 'customer')
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 }
      }
      if (sql.startsWith('INSERT INTO messages')) {
        const [id, tenant_id, api_key_id, batch_id, channel, to_address, from_address, template_slug, subject, body, price_inr, reference, metadata] = params
        rows.set(id, { id, tenant_id, api_key_id, batch_id, channel, to_address, from_address, template_slug, subject, body, price_inr, charged_inr: 0, status: 'queued', provider: null, provider_ref: null, error: null, reference, metadata, created_at: new Date(), updated_at: new Date() })
      } else if (sql.startsWith('UPDATE messages SET status=\'sent\'')) {
        const r = rows.get(params[0])
        Object.assign(r, { status: 'sent', provider: params[1], provider_ref: params[2], charged_inr: params[3], metadata: { ...r.metadata, ...JSON.parse(params[4]) } })
      } else if (sql.startsWith('UPDATE messages SET status=')) {
        Object.assign(rows.get(params[0]), { status: sql.includes("'skipped'") ? 'skipped' : 'failed', error: params[1], charged_inr: 0 })
      }
      return { rows: [], rowCount: 1 }
    }),
  },
  q: vi.fn(async () => []),
  one: vi.fn(async (sql: string, params: any[]) => (sql.startsWith('SELECT * FROM messages') ? rows.get(params[0]) : undefined)),
}))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn().mockResolvedValue({ pools: {} }) }))
vi.mock('../src/templates-v2.js', () => ({ findBySlugWithDefaults: vi.fn().mockResolvedValue(null), liveVersion: vi.fn().mockResolvedValue(null), PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000' }))
vi.mock('@jeffi/wallet', () => ({ debit: vi.fn(), trueUp: vi.fn() }))
vi.mock('../src/providers/email.js', () => ({ sendEmail: vi.fn() }))
vi.mock('../src/providers/twilio.js', () => ({ sendSms: vi.fn(), sendWhatsApp: vi.fn(), normalizePhone: (s: string) => s }))
vi.mock('../src/providers/policy.js', () => ({ messagingProvider: vi.fn(), smsDltEntityId: vi.fn(async () => 'PE1') }))
const { awsSend } = vi.hoisted(() => ({ awsSend: vi.fn() }))
vi.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  PinpointSMSVoiceV2Client: class { send = awsSend },
  SendTextMessageCommand: class { constructor(public input: any) {} },
}))
vi.mock('@aws-sdk/client-socialmessaging', async orig => ({
  ...(await orig<any>()),
  SocialMessagingClient: class { send = awsSend },
  SendWhatsAppMessageCommand: class { constructor(public input: any) {} },
}))

import { sendMessage, SendError } from '../src/send'
import { findBySlugWithDefaults } from '../src/templates-v2'
import * as wallet from '@jeffi/wallet'
import { sendEmail } from '../src/providers/email'
import { sendSms, sendWhatsApp } from '../src/providers/twilio'
import { messagingProvider } from '../src/providers/policy'
import { encryptToken } from '../src/cipher'

// Shaped like FullTemplate — the subset resolveTemplate reads.
const v2 = (subject: string | null, body: string, provider_ref: string | null = null) => ({
  family: { tenant_id: 't1' },
  template: { id: 'tpl1' },
  variant: { id: 'v1', provider_ref, meta_category: null },
  version: { subject, body, blocks: null, layout: 'store' as const },
})

const ctx = { tenantId: 't1', tenantSlug: 'acme', apiKeyId: 'k1' }

describe('sendMessage', () => {
  beforeEach(() => {
    rows.clear()
    vi.mocked(wallet.debit).mockReset().mockResolvedValue({ ok: true, charged: true, balance: 100 } as any)
    vi.mocked(wallet.trueUp).mockReset()
    vi.mocked(sendEmail).mockReset().mockResolvedValue('ses-1')
    vi.mocked(sendSms).mockReset().mockResolvedValue('SM1')
    vi.mocked(sendWhatsApp).mockReset()
    vi.mocked(findBySlugWithDefaults).mockReset().mockResolvedValue(null)
    vi.mocked(messagingProvider).mockReset().mockResolvedValue('twilio')
    awsSend.mockReset()
  })

  it('renders a template, debits the wallet at public price and sends', async () => {
    vi.mocked(findBySlugWithDefaults).mockResolvedValue(v2('Hi {{name}}', '<p>Code {{code}}</p>') as any)
    const m = await sendMessage(ctx, { channel: 'email', to: 'a@b.com', template: 'system/otp', variables: { name: 'Ann', code: '1234' } } as any)
    expect(m.status).toBe('sent')
    expect(m.subject).toBe('Hi Ann')
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({ to: 'a@b.com', subject: 'Hi Ann', from: 'acme@jeffistores.in' })
    const debit = vi.mocked(wallet.debit).mock.calls[0][0]
    expect(debit).toMatchObject({ tenantId: 't1', category: 'email', externalRef: `pub:${m.id}` })
    expect(debit.amountInr).toBeCloseTo(0.05 * 1.4, 5)
    expect(m.charged_inr).toBeCloseTo(0.07, 5)
  })

  it('charges cost price for internal (platform) sends', async () => {
    await sendMessage({ ...ctx, internal: true }, { channel: 'sms', to: '+919999999999', body: 'hello' } as any)
    expect(vi.mocked(wallet.debit).mock.calls[0][0].amountInr).toBe(7)
  })

  it('422s when template variables are missing', async () => {
    vi.mocked(findBySlugWithDefaults).mockResolvedValue(v2('S', 'Code {{code}}') as any)
    await expect(sendMessage(ctx, { channel: 'email', to: 'a@b.com', template: 'x' } as any)).rejects.toMatchObject({ status: 422, code: 'missing_variables' })
  })

  it('404s on an unknown template, 422 on email without subject', async () => {
    vi.mocked(findBySlugWithDefaults).mockResolvedValue(null)
    await expect(sendMessage(ctx, { channel: 'email', to: 'a@b.com', template: 'nope' } as any)).rejects.toBeInstanceOf(SendError)
    await expect(sendMessage(ctx, { channel: 'email', to: 'a@b.com', body: 'x' } as any)).rejects.toMatchObject({ code: 'subject_required' })
  })

  it('402s and marks the row skipped when the wallet is short', async () => {
    vi.mocked(wallet.debit).mockResolvedValue({ ok: false, error: 'insufficient_balance', balance: 1, needed: 6 } as any)
    await expect(sendMessage(ctx, { channel: 'sms', to: '+919999999999', body: 'x' } as any)).rejects.toMatchObject({ status: 402, code: 'insufficient_balance' })
    expect([...rows.values()][0].status).toBe('skipped')
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('refunds (keeping the P2 processing fee) and marks failed when the provider throws', async () => {
    vi.mocked(sendSms).mockRejectedValue(new Error('twilio down'))
    const m = await sendMessage(ctx, { channel: 'sms', to: '+919999999999', body: 'x' } as any)
    expect(m.status).toBe('failed')
    expect(m.error).toBe('twilio down')
    expect(vi.mocked(wallet.trueUp).mock.calls[0][0]).toMatchObject({ tenantId: 't1', amountInr: 0.5, externalRef: `pub:${m.id}` })
  })

  it("sends an API workspace without its own number from the ecom portal's number, a store send from the env", async () => {
    process.env.SOCIAL_TOKEN_ENC_KEY = 'a'.repeat(64)
    const PLATFORM = '00000000-0000-0000-0000-000000000000'
    senderRows.set(`${PLATFORM}:whatsapp`, { audience: 'ecom', provider: 'twilio', sender: '+18722704479', config_enc: encryptToken('{}') })
    vi.mocked(sendWhatsApp).mockResolvedValue('SMwa')

    const api = await sendMessage({ tenantId: 'w1', tenantSlug: 'acme', apiKeyId: 'k1', space: 'api' }, { channel: 'whatsapp', to: '+919999999999', body: 'hi' } as any)
    expect(api).toMatchObject({ status: 'sent', from_address: '+18722704479' })
    expect(vi.mocked(sendWhatsApp).mock.calls[0][1]).toMatchObject({ sender: '+18722704479', tenantId: PLATFORM })

    await sendMessage({ tenantId: 'w2', tenantSlug: 'shop' }, { channel: 'whatsapp', to: '+919999999999', body: 'hi' } as any)
    expect(vi.mocked(sendWhatsApp).mock.calls[1][1]).toBeUndefined()
    delete process.env.SOCIAL_TOKEN_ENC_KEY
  })

  it("sends a store's staff code (billed to the platform) from its admin number, else its customer number, else the platform's", async () => {
    process.env.SOCIAL_TOKEN_ENC_KEY = 'a'.repeat(64)
    const PLATFORM = '00000000-0000-0000-0000-000000000000'
    const row = (audience: string, sender: string) => ({ audience, provider: 'twilio', sender, config_enc: encryptToken('{}') })
    senderRows.set('s1:whatsapp', [row('customer', '+15550000001'), row('admin', '+15550000002')])
    senderRows.set('s2:whatsapp', [row('customer', '+15550000003')])
    senderRows.set(`${PLATFORM}:whatsapp`, [row('customer', '+18722179910'), row('ecom', '+18722704479')])
    vi.mocked(sendWhatsApp).mockResolvedValue('SMwa')
    const staffCode = (store: string) =>
      sendMessage({ tenantId: PLATFORM, tenantSlug: 'platform', internal: true, senderTenant: store }, { channel: 'whatsapp', to: '+919999999999', body: 'code', audience: 'admin' } as any)

    const s1 = await staffCode('s1')
    expect(s1).toMatchObject({ status: 'sent', tenant_id: PLATFORM, from_address: '+15550000002' })
    expect((s1.metadata as any).sender).toEqual({ own: true, provider: 'twilio', audience: 'admin', tenant: 's1' })
    expect(await staffCode('s2')).toMatchObject({ from_address: '+15550000003', metadata: { sender: { audience: 'customer', tenant: 's2' } } })
    const s3 = await staffCode('s3')
    expect(s3.from_address).toBe('+18722179910')
    expect((s3.metadata as any).sender.tenant).toBeUndefined()
    expect(vi.mocked(wallet.debit).mock.calls.map(c => c[0].tenantId)).toEqual([PLATFORM, PLATFORM, PLATFORM])
    delete process.env.SOCIAL_TOKEN_ENC_KEY
  })

  describe('a tenant on AWS End User Messaging', () => {
    const env = { AWS_SMS_ORIGINATION: 'sender-1', AWS_WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-1' }
    afterEach(() => { for (const k of Object.keys(env)) delete process.env[k] })

    it('sends SMS through AWS and records provider aws with its message id', async () => {
      Object.assign(process.env, env)
      vi.mocked(messagingProvider).mockResolvedValue('aws')
      awsSend.mockResolvedValue({ MessageId: 'aws-sms-1' })
      const m = await sendMessage(ctx, { channel: 'sms', to: '+919999999999', body: 'hello' } as any)
      expect(m).toMatchObject({ status: 'sent', provider: 'aws', provider_ref: 'aws-sms-1' })
      expect(awsSend.mock.calls[0][0].input).toMatchObject({ DestinationPhoneNumber: '+919999999999', OriginationIdentity: 'sender-1', MessageBody: 'hello' })
      expect(sendSms).not.toHaveBeenCalled()
      expect(vi.mocked(messagingProvider).mock.calls[0]).toEqual(['t1', 'sms'])
    })

    it('carries the template DLT row (id, header, route) through to the AWS send, and a per-send id override', async () => {
      Object.assign(process.env, env)
      vi.mocked(messagingProvider).mockResolvedValue('aws')
      awsSend.mockResolvedValue({ MessageId: 'aws-sms-2' })
      const tpl = v2(null, 'Order {{order_number}} confirmed')
      ;(tpl.variant as any).dlt = { dlt_template_id: 'TPL-1', dlt_header: 'JEFFIS', dlt_route: 'promotional' }
      vi.mocked(findBySlugWithDefaults).mockResolvedValue(tpl as any)
      await sendMessage(ctx, { channel: 'sms', to: '+919999999999', template: 'order/confirmed', variables: { order_number: '7' } } as any)
      expect(awsSend.mock.calls[0][0].input).toMatchObject({ DestinationCountryParameters: { IN_ENTITY_ID: 'PE1', IN_TEMPLATE_ID: 'TPL-1' }, OriginationIdentity: 'JEFFIS', MessageType: 'PROMOTIONAL' })
      await sendMessage(ctx, { channel: 'sms', to: '+919999999999', template: 'order/confirmed', variables: { order_number: '7' }, dlt_template_id: 'OVR' } as any)
      expect(awsSend.mock.calls[1][0].input.DestinationCountryParameters).toEqual({ IN_ENTITY_ID: 'PE1', IN_TEMPLATE_ID: 'OVR' })
    })

    it('sends a template without a DLT row, and a marketing category, by its category', async () => {
      Object.assign(process.env, env)
      vi.mocked(messagingProvider).mockResolvedValue('aws')
      awsSend.mockResolvedValue({ MessageId: 'aws-sms-3' })
      const tpl: any = v2(null, 'Sale on')
      tpl.family.category = 'marketing'
      vi.mocked(findBySlugWithDefaults).mockResolvedValue(tpl)
      await sendMessage(ctx, { channel: 'sms', to: '+919999999999', template: 'promo/sale' } as any)
      expect(awsSend.mock.calls[0][0].input).toMatchObject({ MessageType: 'PROMOTIONAL', OriginationIdentity: 'sender-1', DestinationCountryParameters: { IN_ENTITY_ID: 'PE1' } })
    })

    it('sends an aws: template ref as a Cloud API template with the body variables in order', async () => {
      Object.assign(process.env, env)
      vi.mocked(messagingProvider).mockResolvedValue('aws')
      vi.mocked(findBySlugWithDefaults).mockResolvedValue(v2(null, 'Your order {{1}} ships on {{2}} — thanks for shopping.', 'aws:acme_order_v1:en') as any)
      awsSend.mockResolvedValue({ messageId: 'wamid.1' })
      const m = await sendMessage(ctx, { channel: 'whatsapp', to: '+919999999999', template: 'order', variables: { 1: 'JS-1', 2: 'Monday' } } as any)
      expect(m).toMatchObject({ status: 'sent', provider: 'aws', provider_ref: 'wamid.1' })
      const input = awsSend.mock.calls[0][0].input
      expect(input.originationPhoneNumberId).toBe('phone-number-id-1')
      expect(JSON.parse(new TextDecoder().decode(input.message)).template).toEqual({
        name: 'acme_order_v1', language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'JS-1' }, { type: 'text', text: 'Monday' }] }],
      })
      expect(sendWhatsApp).not.toHaveBeenCalled()
    })

    it('fails clearly instead of falling back to Twilio when AWS is not configured', async () => {
      vi.mocked(messagingProvider).mockResolvedValue('aws')
      const m = await sendMessage(ctx, { channel: 'sms', to: '+919999999999', body: 'x' } as any)
      expect(m.status).toBe('failed')
      expect(m.error).toMatch(/AWS messaging is not configured/)
      expect(sendSms).not.toHaveBeenCalled()
      expect(awsSend).not.toHaveBeenCalled()
    })
  })
})

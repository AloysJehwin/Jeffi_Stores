import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// In-memory stand-in for the messages table + mocked wallet/providers.
const rows = new Map<string, any>()
vi.mock('../src/db.js', () => ({
  db: {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.startsWith('INSERT INTO messages')) {
        const [id, tenant_id, api_key_id, batch_id, channel, to_address, from_address, template_slug, subject, body, price_inr, reference, metadata] = params
        rows.set(id, { id, tenant_id, api_key_id, batch_id, channel, to_address, from_address, template_slug, subject, body, price_inr, charged_inr: 0, status: 'queued', provider: null, provider_ref: null, error: null, reference, metadata, created_at: new Date(), updated_at: new Date() })
      } else if (sql.startsWith('UPDATE messages SET status=\'sent\'')) {
        Object.assign(rows.get(params[0]), { status: 'sent', provider: params[1], provider_ref: params[2], charged_inr: params[3] })
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
vi.mock('../src/providers/policy.js', () => ({ messagingProvider: vi.fn() }))
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

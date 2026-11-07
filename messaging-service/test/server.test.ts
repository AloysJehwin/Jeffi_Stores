import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SERVICE_AUTH_SECRET = 'test-secret'
process.env.MESSAGING_DATABASE_URL = 'postgres://x'
const rows = new Map<string, any>()
vi.mock('../src/db.js', () => ({
  db: { query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.startsWith('UPDATE messages SET status=')) Object.assign(rows.get(params[0]), { status: params[1] })
    if (sql.startsWith('UPDATE messages SET charged_inr')) Object.assign(rows.get(params[0]), { charged_inr: params[1] })
    return { rows: [], rowCount: 1 }
  }) },
  q: vi.fn(async () => []),
  one: vi.fn(async (sql: string, params: any[]) => {
    if (sql.startsWith('UPDATE messages SET status=')) Object.assign(rows.get(params[0]), { status: params[1] })
    return rows.get(params[0])
  }),
}))
vi.mock('@jeffi/wallet', () => ({ debit: vi.fn(), trueUp: vi.fn() }))
vi.mock('@jeffi/push', () => ({ sendPush: vi.fn() }))
vi.mock('../src/send.js', () => ({ sendMessage: vi.fn(), getMessage: vi.fn(), toApi: (m: any) => m, SendError: class extends Error {} }))
vi.mock('../src/templates.js', () => ({ listTemplates: vi.fn(async () => []), upsertTemplate: vi.fn(), archiveTemplate: vi.fn(), toApi: (t: any) => t }))

import twilio from 'twilio'
import { signServiceToken } from '@jeffi/service-auth'
import * as wallet from '@jeffi/wallet'
import { sendPush } from '@jeffi/push'
import { db } from '../src/db'
import { app } from '../src/server'

process.env.TWILIO_AUTH_TOKEN = 'tw-test-token'
process.env.PUBLIC_BASE_URL = 'https://public.example.test'
// Signed the way Twilio signs a status callback: the registered URL plus the posted form fields.
const twilioHeaders = (m: string, body: string) => ({
  'content-type': 'application/x-www-form-urlencoded',
  'x-twilio-signature': twilio.getExpectedTwilioSignature(
    'tw-test-token',
    `https://public.example.test/webhooks/twilio/status?m=${m}`,
    Object.fromEntries(new URLSearchParams(body))
  ),
})

const auth = (claims = {}) => ({ authorization: `Bearer ${signServiceToken({ service: 'gateway', tenantId: 't1', ...claims })}` })

describe('server', () => {
  beforeEach(() => {
    rows.clear()
    vi.mocked(wallet.trueUp).mockClear()
  })

  it('healthz is open; everything else needs a service token', async () => {
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200)
    expect((await app.inject({ url: '/templates' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/templates', headers: auth() })).statusCode).toBe(200)
  })

  it('Twilio status webhook trues the wallet up to the exact price (public margin vs internal cost)', async () => {
    rows.set('m1', { id: 'm1', tenant_id: 't1', channel: 'sms', to_address: '+91', metadata: {} })
    rows.set('m2', { id: 'm2', tenant_id: 't1', channel: 'sms', to_address: '+91', metadata: { internal: true } })
    const body = 'MessageStatus=delivered&Price=-0.05'
    expect((await app.inject({ method: 'POST', url: '/webhooks/twilio/status?m=m1', headers: twilioHeaders('m1', body), payload: body })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/webhooks/twilio/status?m=m2', headers: twilioHeaders('m2', body), payload: body })).statusCode).toBe(200)
    const [pub, int] = vi.mocked(wallet.trueUp).mock.calls.map(c => c[0].amountInr)
    expect(int).toBeCloseTo(0.05 * 88, 5)
    expect(pub).toBeCloseTo(0.05 * 88 * 1.4, 5)
    expect(rows.get('m1').status).toBe('delivered')
  })

  it('Twilio status webhook refuses unsigned or forged callbacks without touching the wallet', async () => {
    rows.set('m4', { id: 'm4', tenant_id: 't1', channel: 'sms', to_address: '+91', metadata: {} })
    const body = 'MessageStatus=delivered&Price=-50'
    const plain = { 'content-type': 'application/x-www-form-urlencoded' }
    expect((await app.inject({ method: 'POST', url: '/webhooks/twilio/status?m=m4', headers: plain, payload: body })).statusCode).toBe(403)
    const forged = { ...twilioHeaders('m4', 'MessageStatus=delivered&Price=-0.01') }
    expect((await app.inject({ method: 'POST', url: '/webhooks/twilio/status?m=m4', headers: forged, payload: body })).statusCode).toBe(403)
    expect(wallet.trueUp).not.toHaveBeenCalled()
  })

  it('refunds a send that was never delivered (Meta marketing cap), keeping the P2 processing fee and clearing any media surcharge', async () => {
    rows.set('m3', { id: 'm3', tenant_id: 't1', channel: 'whatsapp', to_address: '+91', metadata: {}, charged_inr: '1.4', status: 'sent' })
    const body = 'MessageStatus=undelivered&ErrorCode=63049&Price=-0.01'
    expect((await app.inject({ method: 'POST', url: '/webhooks/twilio/status?m=m3', headers: twilioHeaders('m3', body), payload: body })).statusCode).toBe(200)
    expect(vi.mocked(wallet.trueUp).mock.calls.map(c => c[0])).toEqual([
      { tenantId: 't1', amountInr: 0.2, externalRef: 'pub:m3', note: 'refund: whatsapp not delivered' },
      { tenantId: 't1', amountInr: 0, externalRef: 'media:m3', note: 'refund: media for a non-delivered send' },
    ])
    expect(rows.get('m3')).toMatchObject({ status: 'failed', charged_inr: 0.2 })
  })

  it('push is internal only, logs one row per token and flags dead tokens', async () => {
    const [a, b] = ['a'.repeat(40), 'b'.repeat(40)]
    vi.mocked(sendPush).mockResolvedValue([
      { token: a, ok: true, messageId: 'projects/p/messages/0:1', invalidToken: false },
      { token: b, ok: false, error: 'UNREGISTERED', invalidToken: true },
    ])
    const payload = { tokens: [a, b], title: 'Shipped', body: 'On its way', category: 'orders', link: '/account/orders/1' }
    expect((await app.inject({ method: 'POST', url: '/push', headers: auth(), payload })).statusCode).toBe(403)
    const res = await app.inject({ method: 'POST', url: '/push', headers: auth({ internal: true }), payload })
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toEqual([
      { token: a, ok: true, message_id: 'projects/p/messages/0:1', error: null, invalid_token: false },
      { token: b, ok: false, message_id: null, error: 'UNREGISTERED', invalid_token: true },
    ])
    const log = vi.mocked(db.query).mock.calls.find(c => String(c[0]).includes("'push'"))!
    expect(log[1]!.slice(5)).toEqual([[a, b], ['sent', 'failed'], ['0:1', null], [null, 'UNREGISTERED']])
  })
})

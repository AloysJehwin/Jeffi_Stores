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
vi.mock('../src/send.js', () => ({ sendMessage: vi.fn(), getMessage: vi.fn(), toApi: (m: any) => m, SendError: class extends Error {} }))
vi.mock('../src/templates.js', () => ({ listTemplates: vi.fn(async () => []), upsertTemplate: vi.fn(), archiveTemplate: vi.fn(), toApi: (t: any) => t }))

import { signServiceToken } from '@jeffi/service-auth'
import * as wallet from '@jeffi/wallet'
import { app } from '../src/server'

const auth = (claims = {}) => ({ authorization: `Bearer ${signServiceToken({ service: 'gateway', tenantId: 't1', ...claims })}` })

describe('server', () => {
  beforeEach(() => rows.clear())

  it('healthz is open; everything else needs a service token', async () => {
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200)
    expect((await app.inject({ url: '/templates' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/templates', headers: auth() })).statusCode).toBe(200)
  })

  it('Twilio status webhook trues the wallet up to the exact price (public margin vs internal cost)', async () => {
    rows.set('m1', { id: 'm1', tenant_id: 't1', channel: 'sms', to_address: '+91', metadata: {} })
    rows.set('m2', { id: 'm2', tenant_id: 't1', channel: 'sms', to_address: '+91', metadata: { internal: true } })
    const body = 'MessageStatus=delivered&Price=-0.05'
    const h = { 'content-type': 'application/x-www-form-urlencoded' }
    expect((await app.inject({ method: 'POST', url: '/webhooks/twilio/status?m=m1', headers: h, payload: body })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/webhooks/twilio/status?m=m2', headers: h, payload: body })).statusCode).toBe(200)
    const [pub, int] = vi.mocked(wallet.trueUp).mock.calls.map(c => c[0].amountInr)
    expect(int).toBeCloseTo(0.05 * 88, 5)
    expect(pub).toBeCloseTo(0.05 * 88 * 1.4, 5)
    expect(rows.get('m1').status).toBe('delivered')
  })
})

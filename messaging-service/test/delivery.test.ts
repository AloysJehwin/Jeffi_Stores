import { describe, it, expect, vi, beforeEach } from 'vitest'

const rows = new Map<string, any>()
vi.mock('../src/db.js', () => ({
  db: { query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.startsWith('INSERT INTO message_events')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('UPDATE messages SET charged_inr')) { Object.assign(rows.get(params[0]) ?? {}, { charged_inr: params[1] }); return { rows: [], rowCount: 1 } }
    if (sql.startsWith('UPDATE messages SET updated_at')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }) },
  one: vi.fn(async (sql: string, params: any[]) => {
    // the status-flip UPDATE ... RETURNING
    const m = rows.get(params[0])
    if (!m || m.status === params[1]) return undefined
    Object.assign(m, { status: params[1], error: params[2] ?? m.error })
    return m
  }),
}))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn() }))
vi.mock('@jeffi/wallet', () => ({ trueUp: vi.fn() }))
vi.mock('../src/pricing-sheet.js', () => ({ ensurePricing: vi.fn() }))
vi.mock('../src/providers/twilio.js', () => ({ callbacksEnabled: vi.fn(() => true), fetchStatus: vi.fn() }))
vi.mock('../src/providers/senders.js', () => ({ tenantSender: vi.fn() }))

import { db, one } from '../src/db'
import { poolsForTenant } from '../src/pools'
import * as wallet from '@jeffi/wallet'
import { callbacksEnabled, fetchStatus } from '../src/providers/twilio'
import { tenantSender } from '../src/providers/senders'
import { applyStatus, deliveryReason, startDeliverySync } from '../src/delivery'

describe('deliveryReason', () => {
  it('maps a known Twilio code, falls back to the message, else a default', () => {
    expect(deliveryReason('63049')).toMatch(/marketing cap|held back|marketing/)
    expect(deliveryReason('63049')).toMatch(/\(63049\)$/)
    expect(deliveryReason('99999', 'weird')).toBe('weird (99999)')
    expect(deliveryReason(undefined, 'raw')).toBe('raw')
    expect(deliveryReason(undefined)).toBe('Not delivered')
  })
})

describe('applyStatus', () => {
  beforeEach(() => {
    rows.clear()
    vi.mocked(db.query).mockClear()
    vi.mocked(wallet.trueUp).mockReset()
    vi.mocked(poolsForTenant).mockReset()
  })

  it('a non-terminal status only records an event and touches updated_at', async () => {
    rows.set('m1', { id: 'm1', tenant_id: 't1', channel: 'sms', status: 'sent' })
    await applyStatus('m1', 'queued')
    const calls = vi.mocked(db.query).mock.calls.map(c => String(c[0]))
    expect(calls.some(s => s.startsWith('INSERT INTO message_events'))).toBe(true)
    expect(calls.some(s => s.startsWith('UPDATE messages SET updated_at'))).toBe(true)
    expect(one).not.toHaveBeenCalled()
  })

  it('delivered/read flips the row to delivered, no refund', async () => {
    rows.set('m2', { id: 'm2', tenant_id: 't1', channel: 'sms', status: 'sent', charged_inr: '0.1', metadata: {} })
    await applyStatus('m2', 'read')
    expect(rows.get('m2').status).toBe('delivered')
    expect(wallet.trueUp).not.toHaveBeenCalled()
  })

  it('a failure refunds all but the processing fee and flips a campaign log row', async () => {
    rows.set('m3', { id: 'm3', tenant_id: 't1', channel: 'whatsapp', to_address: '+91', status: 'sent', charged_inr: '1.4', reference: 'messaging:11111111-1111-1111-1111-111111111111', metadata: {} })
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) }
    vi.mocked(poolsForTenant).mockResolvedValue({ pool } as any)
    await applyStatus('m3', 'undelivered', { code: '63049' })
    expect(rows.get('m3').status).toBe('failed')
    // pub refund keeps the fee; media refund is an idempotent 0.
    const refs = vi.mocked(wallet.trueUp).mock.calls.map(c => c[0].externalRef)
    expect(refs).toEqual(['pub:m3', 'media:m3'])
    // the campaign log flip ran on the tenant pool
    expect(String(pool.query.mock.calls[0][0])).toMatch(/email_campaign_logs SET status='failed'/)
    expect(pool.query.mock.calls[0][1]).toEqual(['11111111-1111-1111-1111-111111111111', 'whatsapp', '+91', expect.any(String)])
  })

  it('a failure with no campaign reference skips the campaign-log update', async () => {
    rows.set('m4', { id: 'm4', tenant_id: 't1', channel: 'sms', to_address: '+91', status: 'sent', charged_inr: '0', reference: null, metadata: {} })
    await applyStatus('m4', 'failed', { code: '30003' })
    expect(rows.get('m4').status).toBe('failed')
    expect(poolsForTenant).not.toHaveBeenCalled()
    expect(wallet.trueUp).not.toHaveBeenCalled() // charged_inr 0 → no refund
  })

  it('a terminal status for an already-terminal row (RETURNING nothing) is a no-op', async () => {
    rows.set('m5', { id: 'm5', tenant_id: 't1', channel: 'sms', status: 'failed', charged_inr: '1', metadata: {} })
    await applyStatus('m5', 'failed', { code: '30003' })
    expect(wallet.trueUp).not.toHaveBeenCalled()
    expect(poolsForTenant).not.toHaveBeenCalled()
  })
})

describe('startDeliverySync', () => {
  beforeEach(() => {
    rows.clear()
    vi.mocked(db.query).mockClear()
    vi.mocked(callbacksEnabled).mockReset()
    vi.mocked(fetchStatus).mockReset()
    vi.mocked(tenantSender).mockReset()
  })

  it('does nothing when a public status callback is configured', () => {
    vi.mocked(callbacksEnabled).mockReturnValue(true)
    const spy = vi.spyOn(global, 'setInterval')
    startDeliverySync(() => {}, { tenantId: null, skipStoreTenants: false })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('polls pending sends, uses the store account when the send was from one, and records the status', async () => {
    vi.mocked(callbacksEnabled).mockReturnValue(false)
    rows.set('m1', { id: 'm1', tenant_id: 't1', channel: 'sms', status: 'sent' })
    vi.mocked(db.query).mockImplementation((async (sql: string) =>
      sql.includes('FROM messages') && sql.includes("status='sent'")
        ? { rows: [
            { id: 'm1', provider_ref: 'SM1', tenant_id: 't1', channel: 'sms', metadata: { sender: { own: true, tenant: 's1', audience: 'customer' } } },
            { id: 'm2', provider_ref: 'SM2', tenant_id: 't1', channel: 'whatsapp', metadata: {} },
          ] }
        : { rows: [], rowCount: 1 }) as any)
    rows.set('m2', { id: 'm2', tenant_id: 't1', channel: 'whatsapp', status: 'sent' })
    vi.mocked(tenantSender).mockResolvedValue({ sender: '+1', config: { auth_token: 't' } } as any)
    vi.mocked(fetchStatus).mockResolvedValue({ status: 'delivered' })
    const timer = vi.spyOn(global, 'setInterval').mockReturnValue({ unref: () => {} } as any)

    startDeliverySync(() => {}, { tenantId: null, skipStoreTenants: false })
    await new Promise(r => setTimeout(r, 0)) // let the immediate sweep run
    // the store-account send polled with its own client; the platform one without
    expect(tenantSender).toHaveBeenCalledWith('s1', 'sms', 'customer')
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    timer.mockRestore()
  })
})

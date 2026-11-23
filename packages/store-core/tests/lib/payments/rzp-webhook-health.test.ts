import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
const poolThrows = { value: false }
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => {
    if (poolThrows.value) throw new Error('sync')
    return { query: (...a: any[]) => query(...a) }
  },
}))

import { noteRazorpayWebhook, lastRazorpayWebhook } from '@/lib/payments/rzp-webhook-health'

beforeEach(() => { query.mockReset(); poolThrows.value = false })

describe('noteRazorpayWebhook', () => {
  it('tenant path: UPDATEs tenant_integration_credentials with throttle', () => {
    query.mockResolvedValue({ rows: [] })
    noteRazorpayWebhook('t1')
    const [sql, args] = query.mock.calls[0]
    expect(sql).toContain('UPDATE tenant_integration_credentials')
    expect(sql).toContain("5 minutes")
    expect(args).toEqual(['t1'])
  })
  it('platform path: upserts platform_infra under the platform key', () => {
    query.mockResolvedValue({ rows: [] })
    noteRazorpayWebhook(null)
    const [sql, args] = query.mock.calls[0]
    expect(sql).toContain('INSERT INTO platform_infra')
    expect(args).toEqual(['razorpay_last_webhook_at'])
  })
  it('swallows a rejected query', async () => {
    query.mockRejectedValue(new Error('db'))
    expect(() => noteRazorpayWebhook('t1')).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
  })
  it('swallows a synchronous throw', () => {
    poolThrows.value = true
    expect(() => noteRazorpayWebhook(null)).not.toThrow()
  })
})

describe('lastRazorpayWebhook', () => {
  it('tenant: returns ISO from meta->>last_webhook_at', async () => {
    query.mockResolvedValue({ rows: [{ at: '2026-01-01T00:00:00Z' }] })
    const r = await lastRazorpayWebhook('t1')
    expect(r).toBe(new Date('2026-01-01T00:00:00Z').toISOString())
    expect(query.mock.calls[0][0]).toContain('tenant_integration_credentials')
  })
  it('platform: reads platform_infra', async () => {
    query.mockResolvedValue({ rows: [{ at: '2026-02-02T00:00:00Z' }] })
    const r = await lastRazorpayWebhook(null)
    expect(r).toBe(new Date('2026-02-02T00:00:00Z').toISOString())
    expect(query.mock.calls[0][0]).toContain('platform_infra')
  })
  it('null when no row', async () => {
    query.mockResolvedValue({ rows: [] })
    expect(await lastRazorpayWebhook('t1')).toBeNull()
  })
  it('null when query rejects (caught)', async () => {
    query.mockImplementation(async () => { throw new Error('db') })
    expect(await lastRazorpayWebhook(null)).toBeNull()
  })
})

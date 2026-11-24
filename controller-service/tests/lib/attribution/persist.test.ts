import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn(), enqueue: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/google-ads/ecom-conversions', () => ({ enqueueOwnerConversion: h.enqueue }))

import { NextRequest } from 'next/server'
import { ATTRIBUTION_COOKIE, encodeAttribution, parseAttribution } from '@controller/lib/attribution/capture'
import { fireAndForget } from '@controller/lib/attribution/fire'
import { NEW_OWNER_WINDOW_MS, attributionFromRequest, recordOwnerSignIn, saveOwnerAttribution } from '@controller/lib/attribution/persist'

const NOW = new Date('2026-11-24T10:00:00Z')
const attr = parseAttribution({ gclid: 'g1', utm_source: 'google', utm_campaign: 'ecom_store' }, '/pricing', NOW)!
const fresh = { id: 'o-1', created_at: new Date(NOW.getTime() - 60_000) }
const reqWith = (a?: ReturnType<typeof parseAttribution>) => {
  const r = new NextRequest('https://ecom.jeffistores.in/api/ecom/auth/verify-otp', { method: 'POST' })
  if (a) r.cookies.set(ATTRIBUTION_COOKIE, encodeAttribution(a))
  return r
}

beforeEach(() => {
  h.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 })
  h.enqueue.mockReset().mockResolvedValue(true)
})

describe('saveOwnerAttribution', () => {
  it('inserts the click id, UTM and landing path once for a new owner', async () => {
    expect(await saveOwnerAttribution(fresh, attr, { pool: { query: h.query }, now: NOW })).toBe(true)
    const [sql, params] = h.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO owner_attribution/)
    expect(sql).toMatch(/ON CONFLICT \(owner_id\) DO NOTHING/)
    expect(params[0]).toBe('o-1')
    expect(params.slice(1, 4)).toEqual(['g1', null, null])
    expect(JSON.parse(params[4])).toEqual({ utm_source: 'google', utm_campaign: 'ecom_store' })
    expect(params[5]).toBe('/pricing')
  })

  it('does not replace an existing row (the insert reports no row added)', async () => {
    h.query.mockResolvedValue({ rows: [], rowCount: 0 })
    expect(await saveOwnerAttribution(fresh, attr, { pool: { query: h.query }, now: NOW })).toBe(false)
  })

  it('saves nothing without a cookie, or for an owner who signed up long before', async () => {
    expect(await saveOwnerAttribution(fresh, null, { pool: { query: h.query }, now: NOW })).toBe(false)
    const old = { id: 'o-2', created_at: new Date(NOW.getTime() - NEW_OWNER_WINDOW_MS - 1000) }
    expect(await saveOwnerAttribution(old, attr, { pool: { query: h.query }, now: NOW })).toBe(false)
    expect(h.query).not.toHaveBeenCalled()
  })
})

describe('recordOwnerSignIn', () => {
  it('reads the cookie, saves it and queues the signup conversion', async () => {
    expect(attributionFromRequest(reqWith(attr))?.gclid).toBe('g1')
    await recordOwnerSignIn({ id: 'o-1', created_at: new Date() }, reqWith({ ...attr, seenAt: new Date().toISOString() }))
    expect(h.query).toHaveBeenCalledTimes(1)
    expect(h.enqueue).toHaveBeenCalledWith('o-1', 'ecom_signup')
  })

  it('queues nothing when there is no cookie or the owner already has attribution', async () => {
    await recordOwnerSignIn({ id: 'o-1', created_at: new Date() }, reqWith())
    expect(h.enqueue).not.toHaveBeenCalled()
    h.query.mockResolvedValue({ rows: [], rowCount: 0 })
    await recordOwnerSignIn({ id: 'o-1', created_at: new Date() }, reqWith(attr))
    expect(h.enqueue).not.toHaveBeenCalled()
  })
})

describe('fireAndForget', () => {
  it('never throws or rejects into the caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => fireAndForget('x', async () => { throw new Error('boom') })).not.toThrow()
    expect(() => fireAndForget('y', () => { throw new Error('sync boom') })).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

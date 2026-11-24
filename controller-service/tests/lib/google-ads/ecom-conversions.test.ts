import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  resolveCreds: vi.fn(),
  list: vi.fn(),
  tracking: vi.fn(),
  poolQuery: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: h.poolQuery }) }))
vi.mock('@/lib/import/jobs', () => ({ PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/google-ads/credentials', () => ({ resolveGoogleAdsCreds: h.resolveCreds, googleAdsClientFromCreds: vi.fn(() => ({})) }))
vi.mock('@/lib/google-ads/conversions/actions', () => ({
  listConversionActions: h.list,
  readTrackingSettings: h.tracking,
  actionIdOf: (r: string) => r.split('/').pop(),
}))
vi.mock('@/lib/google-ads/conversions/data-manager', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/google-ads/conversions/data-manager')>()),
  dataManagerClientFor: vi.fn(),
}))

import { GoogleAdsApiError } from '@/lib/google-ads/client'
import { DataManagerApiError, parseDataManagerError } from '@/lib/google-ads/conversions/data-manager'
import {
  ACTION_DEFS,
  ECOM_CONVERSION_ACTIONS,
  enqueueOwnerConversion,
  enqueueTenantConversion,
  ensureEcomConversionActions,
  uploadPendingConversions,
} from '@controller/lib/google-ads/ecom-conversions'

const NOW = new Date('2026-11-24T10:00:00.000Z')
const CREDS = { customerId: '1234567890', loginCustomerId: '9998887776', connectedVia: 'platform' } as any

const act = (name: string, id: string) => ({ name, type: 'UPLOAD_CLICKS', status: 'ENABLED', resourceName: `customers/1234567890/conversionActions/${id}` })
const ALL = [act('ecom_signup', '11'), act('showcase_published', '22'), act('subscription_paid', '33')]

interface Row {
  id: string
  owner_id: string
  action: string
  value_inr: string
  occurred_at: Date
  attempts: number
  status: string
  next_attempt_at: Date
  last_error: string | null
  request_id: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
}
const row = (over: Partial<Row>): Row => ({
  id: 'r1', owner_id: 'o1', action: 'ecom_signup', value_inr: '0', occurred_at: new Date('2026-11-24T09:00:00.123Z'), attempts: 0,
  status: 'pending', next_attempt_at: new Date(0), last_error: null, request_id: null, gclid: 'g1', gbraid: null, wbraid: null, ...over,
})

/** A tiny in-memory owner_conversion_uploads: answers the uploader's SELECT and applies its UPDATEs. */
function fakeTable(rows: Row[]) {
  h.poolQuery.mockImplementation(async (sql: string, p: any[] = []) => {
    if (/^\s*SELECT/.test(sql)) return { rows: rows.filter(r => r.status === 'pending' && r.next_attempt_at <= new Date(p[0])).map(r => ({ ...r })) }
    const r = rows.find(x => x.id === p[0])!
    if (/status = 'uploaded'/.test(sql)) Object.assign(r, { status: 'uploaded', request_id: p[2], attempts: r.attempts + 1, last_error: null })
    else if (/status = 'failed', attempts = attempts \+ 1/.test(sql)) Object.assign(r, { status: 'failed', attempts: r.attempts + 1, last_error: p[1] })
    else Object.assign(r, { attempts: p[1], last_error: p[2], status: p[3], next_attempt_at: new Date(p[4]) })
    return { rows: [], rowCount: 1 }
  })
  return rows
}

const dmClient = () => ({ ingestEvents: vi.fn().mockResolvedValue({ requestId: 'req-1' }) })
const adsFake = (post = vi.fn()) => ({ customerId: '1234567890', forCustomer: vi.fn(), post }) as any

beforeEach(() => {
  vi.clearAllMocks()
  h.list.mockReset().mockResolvedValue(ALL)
  h.tracking.mockReset().mockResolvedValue(null)
  h.resolveCreds.mockReset().mockResolvedValue(CREDS)
})

describe('queueing', () => {
  it('queues only owners with a stored click id, once per (owner, action)', async () => {
    h.poolQuery.mockResolvedValue({ rows: [], rowCount: 1 })
    expect(await enqueueOwnerConversion('o1', 'ecom_signup', { occurredAt: NOW })).toBe(true)
    const [sql, params] = h.poolQuery.mock.calls[0]
    expect(sql).toMatch(/FROM owner_attribution a WHERE a\.owner_id = \$1 AND \(a\.gclid IS NOT NULL OR a\.gbraid IS NOT NULL OR a\.wbraid IS NOT NULL\)/)
    expect(sql).toMatch(/ON CONFLICT \(owner_id, action\) DO NOTHING/)
    expect(params).toEqual(['o1', 'ecom_signup', 0, NOW.toISOString()])
    h.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    expect(await enqueueOwnerConversion('o1', 'ecom_signup')).toBe(false)
  })

  it('queues a subscription charge for the tenant owners with its value', async () => {
    h.poolQuery.mockResolvedValue({ rows: [], rowCount: 2 })
    expect(await enqueueTenantConversion('t1', 'subscription_paid', { valueInr: 999 })).toBe(2)
    const [sql, params] = h.poolQuery.mock.calls[0]
    expect(sql).toMatch(/FROM owner_tenants ot JOIN owner_attribution a/)
    expect(params.slice(0, 3)).toEqual(['t1', 'subscription_paid', 999])
  })
})

describe('ensureEcomConversionActions', () => {
  it('creates only the missing import actions and reads them back', async () => {
    h.list.mockResolvedValueOnce([ALL[0]]).mockResolvedValueOnce(ALL)
    const post = vi.fn().mockResolvedValue({})
    const refs = await ensureEcomConversionActions(adsFake(post))
    expect(post).toHaveBeenCalledTimes(1)
    const ops = post.mock.calls[0][1].operations
    expect(ops.map((o: any) => o.create.name)).toEqual(['showcase_published', 'subscription_paid'])
    expect(ops[0].create).toMatchObject({ type: 'UPLOAD_CLICKS', category: ACTION_DEFS.showcase_published.category, primaryForGoal: false })
    expect(ops[1].create.category).toBe('SUBSCRIBE_PAID')
    expect(refs.ecom_signup.created).toBe(false)
    expect(refs.subscription_paid).toMatchObject({ created: true, resourceName: ALL[2].resourceName })
  })

  it('creates nothing when all three exist, and survives a duplicate-name race', async () => {
    const post = vi.fn()
    expect(Object.keys(await ensureEcomConversionActions(adsFake(post)))).toEqual([...ECOM_CONVERSION_ACTIONS])
    expect(post).not.toHaveBeenCalled()
    h.list.mockResolvedValueOnce([]).mockResolvedValueOnce(ALL)
    const dup = vi.fn().mockRejectedValue(new GoogleAdsApiError('dup', 400, ['DUPLICATE_NAME'], null, false))
    expect((await ensureEcomConversionActions(adsFake(dup))).ecom_signup.resourceName).toBe(ALL[0].resourceName)
  })
})

describe('uploadPendingConversions', () => {
  it('sends each pending row once, per action, with click id, UTC time and value', async () => {
    const rows = fakeTable([
      row({ id: 'r1' }),
      row({ id: 'r2', owner_id: 'o2', gclid: null, gbraid: 'gb2' }),
      row({ id: 'r3', owner_id: 'o3', action: 'subscription_paid', value_inr: '999.00', gclid: null, wbraid: 'wb3' }),
    ])
    const dm = dmClient()
    const first = await uploadPendingConversions({ pool: { query: h.poolQuery }, creds: CREDS, ads: adsFake(), dm: dm as any, now: NOW })
    expect(first).toMatchObject({ picked: 3, uploaded: 3, failed: 0, retrying: 0 })
    expect(dm.ingestEvents).toHaveBeenCalledTimes(2)
    const signup = dm.ingestEvents.mock.calls[0][0]
    expect(signup.destinations[0]).toMatchObject({ operatingAccount: { accountId: '1234567890' }, loginAccount: { accountId: '9998887776' }, productDestinationId: '11' })
    expect(signup.events).toEqual([
      { transactionId: 'ecom_signup:o1', eventTimestamp: '2026-11-24T09:00:00Z', eventSource: 'WEB', conversionValue: 0, currency: 'INR', adIdentifiers: { gclid: 'g1' } },
      expect.objectContaining({ transactionId: 'ecom_signup:o2', adIdentifiers: { gbraid: 'gb2' } }),
    ])
    const paid = dm.ingestEvents.mock.calls[1][0]
    expect(paid.destinations[0].productDestinationId).toBe('33')
    expect(paid.events[0]).toMatchObject({ conversionValue: 999, adIdentifiers: { wbraid: 'wb3' } })
    expect(rows.every(r => r.status === 'uploaded' && r.request_id === 'req-1')).toBe(true)

    // Idempotent: nothing is pending, so a second run does not touch Google at all.
    const again = await uploadPendingConversions({ pool: { query: h.poolQuery }, creds: CREDS, ads: adsFake(), dm: dm as any, now: NOW })
    expect(again).toMatchObject({ picked: 0, uploaded: 0, skipped: 'nothing_pending' })
    expect(dm.ingestEvents).toHaveBeenCalledTimes(2)
  })

  it('keeps a row pending with a backoff and the error when Google fails, then gives up after the attempts', async () => {
    const rows = fakeTable([row({ id: 'r1' })])
    const dm = { ingestEvents: vi.fn().mockRejectedValue(new Error('Data Manager API is down')) }
    const run = (now: Date, maxAttempts = 3) =>
      uploadPendingConversions({ pool: { query: h.poolQuery }, creds: CREDS, ads: adsFake(), dm: dm as any, now, maxAttempts })
    const r1 = await run(NOW)
    expect(r1).toMatchObject({ uploaded: 0, retrying: 1, failed: 0 })
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'Data Manager API is down' })
    expect(rows[0].next_attempt_at.getTime()).toBeGreaterThan(NOW.getTime())
    // Not due yet: skipped without calling Google again.
    expect((await run(NOW)).skipped).toBe('nothing_pending')
    expect(dm.ingestEvents).toHaveBeenCalledTimes(1)
    await run(new Date(NOW.getTime() + 24 * 3600_000))
    const last = await run(new Date(NOW.getTime() + 48 * 3600_000))
    expect(last.failed).toBe(1)
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 3 })
  })

  it('fails only the events Google rejects and sends the rest next run', async () => {
    const rows = fakeTable([row({ id: 'r1', gclid: 'bad' }), row({ id: 'r2', owner_id: 'o2', gclid: 'good' })])
    const err = parseDataManagerError(
      { error: { status: 'INVALID_ARGUMENT', message: 'bad', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'events[0].ad_identifiers', reason: 'INVALID_GCLID', description: 'Invalid gclid' }] }] } },
    400
  )
    expect(err).toBeInstanceOf(DataManagerApiError)
    const dm = { ingestEvents: vi.fn().mockRejectedValueOnce(err).mockResolvedValue({ requestId: 'req-2' }) }
    const run = () => uploadPendingConversions({ pool: { query: h.poolQuery }, creds: CREDS, ads: adsFake(), dm: dm as any, now: NOW })
    expect(await run()).toMatchObject({ failed: 1, retrying: 1, uploaded: 0 })
    expect(rows[0]).toMatchObject({ status: 'failed' })
    expect(rows[0].last_error).toMatch(/INVALID_GCLID/)
    expect(rows[1].status).toBe('pending')
    expect(await run()).toMatchObject({ uploaded: 1 })
    expect(rows[1]).toMatchObject({ status: 'uploaded', request_id: 'req-2' })
    expect(dm.ingestEvents.mock.calls[1][0].events).toHaveLength(1)
  })

  it('records the error and retries when the conversion actions cannot be read', async () => {
    const rows = fakeTable([row({ id: 'r1' })])
    h.list.mockRejectedValue(new Error('PERMISSION_DENIED'))
    const dm = dmClient()
    const r = await uploadPendingConversions({ pool: { query: h.poolQuery }, creds: CREDS, ads: adsFake(), dm: dm as any, now: NOW })
    expect(r).toMatchObject({ skipped: 'actions_unavailable', retrying: 1 })
    expect(rows[0].last_error).toMatch(/conversion actions: PERMISSION_DENIED/)
    expect(dm.ingestEvents).not.toHaveBeenCalled()
  })

  it('leaves the rows alone when the platform account is not connected', async () => {
    const rows = fakeTable([row({ id: 'r1' })])
    h.resolveCreds.mockRejectedValue(new Error('not connected'))
    const r = await uploadPendingConversions({ pool: { query: h.poolQuery }, now: NOW })
    expect(r).toMatchObject({ picked: 1, uploaded: 0, skipped: 'not_connected' })
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })
})

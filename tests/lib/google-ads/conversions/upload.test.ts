import { describe, it, expect, vi, beforeEach } from 'vitest'

const conn = { query: vi.fn(), release: vi.fn() }
vi.mock('@/lib/shared/db', () => ({ getClient: vi.fn(async () => conn), queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/google-ads/credentials', () => ({
  googleAdsClientFor: vi.fn(),
  googleAdsClientFromCreds: vi.fn(),
  googleAdsEnvStatus: vi.fn(() => ({ developerToken: true })),
  resolveGoogleAdsCreds: vi.fn(),
}))

import { GoogleAdsApiError } from '@/lib/google-ads/client'
import { parseDataManagerError, DataManagerApiError, SCOPE_MISSING } from '@/lib/google-ads/conversions/data-manager'
import {
  ADS_CONVERSIONS_LOCK_KEY,
  ConversionUploadInProgressError,
  afterFailure,
  buildAdjustment,
  buildAdjustmentEvent,
  buildClickConversion,
  buildPurchaseEvent,
  consentFor,
  jobIdFor,
  mapPartialFailure,
  uploadConversions,
  type DueRow,
} from '@/lib/google-ads/conversions/upload'
import { sha256Hex } from '@/lib/google-ads/conversions/hash'

const NOW = new Date('2026-10-16T06:00:00Z')
const HOUR = 3_600_000
const ACTION = 'customers/1234567890/conversionActions/777'
const FAILURE = 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure'

const due = (r: Partial<DueRow>): DueRow => ({
  id: 1,
  order_id: 'o1',
  order_number: 'ORD-1',
  kind: 'purchase',
  version: 0,
  value: '1180.00',
  currency_code: 'INR',
  gclid: 'g1',
  gbraid: null,
  wbraid: null,
  click_at: '2026-10-15T08:00:00Z',
  conversion_at: '2026-10-15T09:00:00Z',
  adjustment_at: null,
  status: 'pending',
  attempts: 0,
  conversion_action: null,
  uploaded_at: null,
  customer_email: 'Jane.Doe@gmail.com',
  customer_phone: '9876543210',
  ads_consent: true,
  ...r,
})

interface World {
  lock?: boolean
  api?: 'data_manager' | 'ads_api'
  config?: Record<string, unknown> | null
  purchases?: DueRow[]
  siblings?: Partial<DueRow>[]
  adjustments?: DueRow[]
  adjustPurchases?: Partial<DueRow>[]
  requests?: Record<string, unknown>[]
  requestRows?: Record<string, unknown[]>
}

function setDb(w: World) {
  conn.query.mockImplementation(async (sql: string, params?: any[]) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: w.lock ?? true }] }
    if (sql.includes('FROM orders o')) return { rows: [] }
    if (sql.includes("error_code = 'CLICK_WINDOW'") || sql.includes("error_code = 'ADJUSTMENT_WINDOW'")) return { rows: [], rowCount: 0 }
    if (sql.includes('conversion_action_owner') && sql.includes('FROM ads_account')) {
      return { rows: w.config === null ? [] : [{ ...config(), ...(w.api ? { conversion_upload_api: w.api } : {}), ...(w.config ?? {}) }] }
    }
    if (sql.startsWith('SELECT time_zone FROM ads_account')) return { rows: [{ time_zone: 'Asia/Kolkata' }] }
    if (sql.includes("u.kind = 'purchase' AND u.next_attempt_at")) return { rows: w.purchases ?? [] }
    if (sql.includes("WHERE kind <> 'purchase' AND order_id = ANY")) return { rows: w.siblings ?? [] }
    if (sql.includes("u.kind <> 'purchase' AND u.next_attempt_at")) return { rows: w.adjustments ?? [] }
    if (sql.includes("p.kind = 'purchase' AND p.order_id = ANY")) return { rows: w.adjustPurchases ?? [] }
    if (sql.includes('FROM ads_conversion_requests') && sql.includes('finished_at IS NULL')) return { rows: w.requests ?? [] }
    if (sql.includes('FROM ads_conversion_uploads WHERE request_id = $1')) return { rows: w.requestRows?.[params?.[0]] ?? [] }
    return { rows: [], rowCount: 0 }
  })
}

const config = (o: Record<string, unknown> = {}) => ({
  customer_id: '1234567890',
  conversion_action: ACTION,
  conversion_action_name: 'Purchase (server)',
  conversion_action_owner: '1234567890',
  conversion_action_account: '1234567890',
  conversion_action_set_at: '2026-10-01T00:00:00Z',
  conversion_last_run_at: null,
  conversion_last_run: null,
  time_zone: 'Asia/Kolkata',
  ...o,
})

function fakeAds(post: (path: string, body: any) => any, enhanced = 'ON', loginCustomerId: string | null = null) {
  const ads: any = {
    customerId: '1234567890',
    loginCustomerId,
    post: vi.fn(async (path: string, body: any) => post(path, body)),
    searchStream: vi.fn(async () => [
      {
        customer: {
          conversionTrackingSetting: {
            googleAdsConversionCustomer: 'customers/1234567890',
            acceptedCustomerDataTerms: true,
            effectiveEnablementSetting: enhanced,
          },
        },
      },
    ]),
  }
  ads.forCustomer = vi.fn((id: string) => ({ ...ads, customerId: id }))
  return ads
}

function fakeDm(ingest: (body: any, call: number) => any, status: (id: string) => any = () => ({})) {
  let n = 0
  return {
    ingestEvents: vi.fn(async (body: any) => ingest(body, n++)),
    retrieveRequestStatus: vi.fn(async (id: string) => status(id)),
  } as any
}

/** A Data Manager error as Google returns it, parsed by the client. */
const dmError = (httpStatus: number, error: Record<string, unknown>) => parseDataManagerError({ error }, httpStatus)
const badRequest = (...violations: { field: string; reason: string; description?: string }[]) =>
  dmError(400, {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: 'There was a problem with the request.',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'INVALID_ARGUMENT', domain: 'datamanager.googleapis.com' },
      { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: violations },
    ],
  })

type Written = { status: string; inc: number; code: string | null; error: string | null; nextAt: Date | null; value: number | null; action: string | null; jobId: string | null; requestId: string | null }

/** The rows written by the batched UPDATE ... FROM unnest(...) calls, flattened by id. */
function updates(): Record<number, Written> {
  const out: Record<number, Written> = {}
  for (const [sql, p] of conn.query.mock.calls as [string, any[]][]) {
    if (!sql.startsWith('UPDATE ads_conversion_uploads u SET')) continue
    p[0].forEach((id: number, i: number) => {
      out[id] = { status: p[1][i], inc: p[2][i], code: p[3][i], error: p[4][i], nextAt: p[5][i], value: p[6][i], action: p[7][i], jobId: p[8][i], requestId: p[9][i] }
    })
  }
  return out
}

const sqlCalls = () => conn.query.mock.calls.map(c => String(c[0]))
const callsWith = (needle: string) => conn.query.mock.calls.filter(c => String(c[0]).includes(needle))

beforeEach(() => {
  vi.clearAllMocks()
  setDb({})
})

describe('Google Ads API payloads', () => {
  const opts = { action: ACTION, timeZone: 'Asia/Kolkata', identifiers: true }

  it('builds a click conversion with consent and hashed identifiers', () => {
    expect(buildClickConversion(due({}), opts)).toEqual({
      conversionAction: ACTION,
      conversionDateTime: '2026-10-15 14:30:00+05:30',
      conversionValue: 1180,
      currencyCode: 'INR',
      orderId: 'ORD-1',
      gclid: 'g1',
      consent: { adUserData: 'GRANTED' },
      userIdentifiers: [
        { userIdentifierSource: 'FIRST_PARTY', hashedEmail: sha256Hex('janedoe@gmail.com') },
        { userIdentifierSource: 'FIRST_PARTY', hashedPhoneNumber: sha256Hex('+919876543210') },
      ],
    })
  })

  it('denies without ads consent, leaves consent unset when no choice was recorded, and drops identifiers', () => {
    const denied = buildClickConversion(due({ ads_consent: false }), opts)
    expect(denied.consent).toEqual({ adUserData: 'DENIED' })
    expect(denied).not.toHaveProperty('userIdentifiers')
    const unknown = buildClickConversion(due({ ads_consent: null }), opts)
    expect(unknown).not.toHaveProperty('consent')
    expect(unknown).not.toHaveProperty('userIdentifiers')
    const off = buildClickConversion(due({}), { ...opts, identifiers: false })
    expect(off.consent).toEqual({ adUserData: 'GRANTED' })
    expect(off).not.toHaveProperty('userIdentifiers')
  })

  it('builds retractions and restatements by order id', () => {
    const at = '2026-10-17T06:00:00Z'
    expect(buildAdjustment(due({ kind: 'retraction', value: 0, adjustment_at: at }), { action: ACTION, timeZone: 'Asia/Kolkata' })).toEqual({
      conversionAction: ACTION,
      adjustmentType: 'RETRACTION',
      orderId: 'ORD-1',
      adjustmentDateTime: '2026-10-17 11:30:00+05:30',
    })
    expect(buildAdjustment(due({ kind: 'restatement', value: '900.50', adjustment_at: at }), { action: ACTION, timeZone: 'Asia/Kolkata' })).toMatchObject({
      adjustmentType: 'RESTATEMENT',
      restatementValue: { adjustedValue: 900.5, currencyCode: 'INR' },
    })
  })

  it("keeps job ids inside Google's range", () => {
    const id = jobIdFor(NOW)
    expect(id).toBeGreaterThanOrEqual(1)
    expect(id).toBeLessThan(2 ** 31)
  })
})

describe('Data Manager payloads', () => {
  it('builds a purchase event: transaction id, RFC 3339 time, WEB source, click id, consent and hashed identifiers', () => {
    expect(buildPurchaseEvent(due({}), true)).toEqual({
      transactionId: 'ORD-1',
      eventTimestamp: '2026-10-15T09:00:00Z',
      eventSource: 'WEB',
      conversionValue: 1180,
      currency: 'INR',
      adIdentifiers: { gclid: 'g1' },
      consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
      userData: { userIdentifiers: [{ emailAddress: sha256Hex('janedoe@gmail.com') }, { phoneNumber: sha256Hex('+919876543210') }] },
    })
  })

  it('sends identifiers only with ads consent and enhanced conversions; no consent choice means none sent', () => {
    expect(buildPurchaseEvent(due({ ads_consent: false }), true)).toMatchObject({
      consent: { adUserData: 'CONSENT_DENIED', adPersonalization: 'CONSENT_DENIED' },
    })
    expect(buildPurchaseEvent(due({ ads_consent: false }), true)).not.toHaveProperty('userData')
    const unknown = buildPurchaseEvent(due({ ads_consent: null, gclid: null, wbraid: 'w1' }), true)
    expect(unknown).not.toHaveProperty('consent')
    expect(unknown).not.toHaveProperty('userData')
    expect(unknown.adIdentifiers).toEqual({ wbraid: 'w1' })
    expect(buildPurchaseEvent(due({}), false)).not.toHaveProperty('userData')
    expect(consentFor(undefined)).toBeNull()
  })

  it('adjusts by re-sending the purchase with the new value; a retraction is a value of 0', () => {
    const purchase = { conversion_at: '2026-10-14T10:00:00Z', gclid: 'g-orig', gbraid: null, wbraid: null }
    const r = buildAdjustmentEvent(due({ kind: 'retraction', value: '0', adjustment_at: '2026-10-16T05:00:00Z', gclid: 'other' }), purchase, false, NOW)
    expect(r).toEqual({
      transactionId: 'ORD-1',
      eventTimestamp: '2026-10-14T10:00:00Z',
      lastUpdatedTimestamp: '2026-10-16T05:00:00Z',
      eventSource: 'WEB',
      conversionValue: 0,
      currency: 'INR',
      adIdentifiers: { gclid: 'g-orig' },
      consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
    })
    expect(buildAdjustmentEvent(due({ kind: 'restatement', value: '900.50' }), purchase, false, NOW).conversionValue).toBe(900.5)
  })
})

describe('mapPartialFailure', () => {
  const failure = (index: number | undefined, code: string, field = 'conversions') => ({
    errorCode: { conversionUploadError: code },
    message: `msg ${code}`,
    location: { fieldPathElements: [{ fieldName: field, ...(index === undefined ? {} : { index }) }] },
  })

  it('maps errors to rows by field path index', () => {
    const res = {
      results: [{ gclid: 'a' }, {}, {}],
      partialFailureError: { message: 'batch', details: [{ '@type': FAILURE, errors: [failure(2, 'EXPIRED_EVENT'), failure(1, 'TOO_RECENT_EVENT')] }] },
    }
    expect(mapPartialFailure(res, 3, 'conversions')).toEqual([
      { ok: true, code: '', message: '' },
      { ok: false, code: 'TOO_RECENT_EVENT', message: 'msg TOO_RECENT_EVENT' },
      { ok: false, code: 'EXPIRED_EVENT', message: 'msg EXPIRED_EVENT' },
    ])
  })

  it('handles adjustments, a lone row without an index, and empty results', () => {
    const adj = { results: [{}], partialFailureError: { message: 'b', details: [{ '@type': FAILURE, errors: [failure(undefined, 'CONVERSION_NOT_FOUND', 'conversion_adjustments')] }] } }
    expect(mapPartialFailure(adj, 1, 'conversion_adjustments')[0]).toMatchObject({ ok: false, code: 'CONVERSION_NOT_FOUND' })
    const unexplained = { results: [{ gclid: 'a' }, {}], partialFailureError: { message: 'Something failed', details: [] } }
    expect(mapPartialFailure(unexplained, 2, 'conversions')[1]).toEqual({ ok: false, code: '', message: 'Something failed' })
    expect(mapPartialFailure({ results: [{ gclid: 'a' }] }, 1, 'conversions')).toEqual([{ ok: true, code: '', message: '' }])
  })
})

describe('afterFailure', () => {
  it('retries with the longer of the backoff and the code delay, then fails', () => {
    const c = { outcome: 'retry' as const, delayMs: 6 * HOUR, message: 'wait' }
    expect(afterFailure({ id: 1, attempts: 0 }, c, NOW)).toMatchObject({ status: 'pending', inc: 1, nextAt: new Date(NOW.getTime() + 6 * HOUR) })
    expect(afterFailure({ id: 1, attempts: 6 }, { ...c, delayMs: 0 }, NOW).nextAt).toEqual(new Date(NOW.getTime() + 24 * HOUR))
    expect(afterFailure({ id: 1, attempts: 7 }, c, NOW)).toMatchObject({ status: 'failed', nextAt: null })
    expect(afterFailure({ id: 1, attempts: 0 }, { outcome: 'failed', delayMs: 0, message: 'no' }, NOW).status).toBe('failed')
  })
})

describe('uploadConversions (any API)', () => {
  it('refuses to overlap a running upload', async () => {
    setDb({ lock: false })
    await expect(uploadConversions({ client: fakeAds(() => ({})), dm: fakeDm(() => ({})), now: NOW })).rejects.toBeInstanceOf(
      ConversionUploadInProgressError
    )
    expect(sqlCalls().some(s => s.includes('pg_advisory_unlock'))).toBe(false)
    expect(conn.release).toHaveBeenCalledTimes(1)
  })

  it('sweeps and expires but sends nothing without a conversion action', async () => {
    setDb({ config: { conversion_action: null } })
    const ads = fakeAds(() => ({}))
    const dm = fakeDm(() => ({}))
    const r = await uploadConversions({ client: ads, dm, now: NOW })
    expect(r).toMatchObject({ status: 'not_configured', api: 'data_manager' })
    expect(ads.post).not.toHaveBeenCalled()
    expect(dm.ingestEvents).not.toHaveBeenCalled()
    const sql = sqlCalls()
    expect(conn.query.mock.calls[0]).toEqual(['SELECT pg_try_advisory_lock($1) AS acquired', [ADS_CONVERSIONS_LOCK_KEY]])
    expect(sql.some(s => s.includes('FROM orders o'))).toBe(true)
    expect(sql.some(s => s.includes("error_code = 'CLICK_WINDOW'"))).toBe(true)
    expect(sql.some(s => s.startsWith('UPDATE ads_account SET conversion_last_run_at'))).toBe(true)
    expect(sql[sql.length - 1]).toBe('SELECT pg_advisory_unlock($1)')
  })

  it('pauses when the action was chosen for another account', async () => {
    setDb({ config: { conversion_action_account: '9999999999' }, purchases: [due({})] })
    const dm = fakeDm(() => ({ requestId: 'r' }))
    expect((await uploadConversions({ client: fakeAds(() => ({})), dm, now: NOW })).status).toBe('not_configured')
    expect(dm.ingestEvents).not.toHaveBeenCalled()
  })
})

describe('uploadConversions through the Data Manager API (default)', () => {
  it('sends due purchases with events:ingest and records the request for diagnostics', async () => {
    setDb({
      purchases: [
        due({ id: 1 }),
        due({ id: 2, order_id: 'o2', order_number: 'ORD-2', gclid: 'g2', ads_consent: false }),
        due({ id: 3, order_id: 'o3', order_number: 'ORD-3', gclid: null, gbraid: 'b3', ads_consent: null }),
      ],
    })
    const ads = fakeAds(() => ({}))
    const dm = fakeDm(() => ({ requestId: 'req-1' }))
    const r = await uploadConversions({ client: ads, dm, now: NOW })

    expect(ads.post).not.toHaveBeenCalled()
    expect(dm.ingestEvents).toHaveBeenCalledTimes(1)
    const body = dm.ingestEvents.mock.calls[0][0]
    expect(body).toEqual({
      destinations: [{ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' }, productDestinationId: '777' }],
      events: expect.any(Array),
      encoding: 'HEX',
    })
    expect(body.events[0]).toMatchObject({ transactionId: 'ORD-1', conversionValue: 1180, adIdentifiers: { gclid: 'g1' } })
    expect(body.events[0].userData.userIdentifiers).toHaveLength(2)
    expect(body.events[1]).toMatchObject({ transactionId: 'ORD-2', consent: { adUserData: 'CONSENT_DENIED' } })
    expect(body.events[1].userData).toBeUndefined()
    expect(body.events[2]).toMatchObject({ transactionId: 'ORD-3', adIdentifiers: { gbraid: 'b3' } })
    expect(body.events[2].consent).toBeUndefined()

    const u = updates()
    for (const id of [1, 2, 3]) expect(u[id]).toMatchObject({ status: 'uploaded', inc: 1, action: ACTION, requestId: 'req-1', jobId: null })
    const insert = callsWith('INSERT INTO ads_conversion_requests')[0]
    expect(insert[1]).toEqual(['req-1', 'purchase', 3, '[]', new Date(NOW.getTime() + 30 * 60_000), NOW])
    expect(r).toMatchObject({ status: 'success', api: 'data_manager', uploaded: 3, requests: 1, identifiers: true })
  })

  it('sends to the conversion action owner through the manager the connection uses', async () => {
    setDb({ config: { conversion_action_owner: '1112223334' }, purchases: [due({})] })
    const ads = fakeAds(() => ({}), 'ON', '5556667778')
    const dm = fakeDm(() => ({ requestId: 'req-1' }))
    await uploadConversions({ client: ads, dm, now: NOW })
    expect(dm.ingestEvents.mock.calls[0][0].destinations).toEqual([
      {
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1112223334' },
        loginAccount: { accountType: 'GOOGLE_ADS', accountId: '5556667778' },
        productDestinationId: '777',
      },
    ])
  })

  it('folds a queued restatement into the purchase and sends nothing for an order already cancelled', async () => {
    setDb({
      purchases: [due({ id: 1 }), due({ id: 2, order_id: 'o2', order_number: 'ORD-2' })],
      siblings: [
        { id: 3, order_id: 'o1', kind: 'restatement', version: 1, value: '900.00', status: 'pending' },
        { id: 4, order_id: 'o2', kind: 'retraction', version: 0, value: '0', status: 'pending' },
      ],
    })
    const dm = fakeDm(() => ({ requestId: 'req-1' }))
    await uploadConversions({ client: fakeAds(() => ({})), dm, now: NOW })
    expect(dm.ingestEvents.mock.calls[0][0].events.map((e: any) => [e.transactionId, e.conversionValue])).toEqual([['ORD-1', 900]])
    const u = updates()
    expect(u[1]).toMatchObject({ status: 'uploaded', value: 900 })
    expect(u[3]).toMatchObject({ status: 'skipped', code: 'FOLDED' })
    expect(u[2]).toMatchObject({ status: 'skipped', code: 'CANCELLED_BEFORE_UPLOAD' })
    expect(u[4]).toMatchObject({ status: 'skipped', code: 'CANCELLED_BEFORE_UPLOAD' })
  })

  it('settles the events a fast-fail error names and sends the rest again', async () => {
    setDb({ purchases: [due({ id: 1 }), due({ id: 2, order_id: 'o2', order_number: 'ORD-2' }), due({ id: 3, order_id: 'o3', order_number: 'ORD-3' })] })
    const dm = fakeDm((_body, call) => {
      if (call === 0) {
        throw badRequest(
          { field: 'events.events[1].event_timestamp', reason: 'EVENT_TIME_INVALID', description: 'Event did not occur within the acceptable time window.' },
          { field: 'events.events[2].user_data.user_identifiers[0]', reason: 'INVALID_HEX_ENCODING', description: 'The HEX encoded value is malformed.' }
        )
      }
      return { requestId: 'req-2' }
    })
    const r = await uploadConversions({ client: fakeAds(() => ({})), dm, now: NOW })
    expect(dm.ingestEvents).toHaveBeenCalledTimes(2)
    expect(dm.ingestEvents.mock.calls[1][0].events.map((e: any) => e.transactionId)).toEqual(['ORD-1'])
    const u = updates()
    expect(u[1]).toMatchObject({ status: 'uploaded', requestId: 'req-2' })
    expect(u[2]).toMatchObject({ status: 'skipped', code: 'EVENT_TIME_INVALID' })
    expect(u[3]).toMatchObject({ status: 'failed', code: 'INVALID_HEX_ENCODING', inc: 1 })
    expect(u[3].error).toContain('The HEX encoded value is malformed.')
    expect(r).toMatchObject({ uploaded: 1, skipped: 1, failed: 1, status: 'partial' })
  })

  it('sends again without email and phone when Google refuses enhanced-conversion data', async () => {
    setDb({ purchases: [due({})] })
    const dm = fakeDm((_body, call) => {
      if (call === 0) throw badRequest({ field: 'destinations[0]', reason: 'DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED' })
      return { requestId: 'req-3' }
    })
    const r = await uploadConversions({ client: fakeAds(() => ({})), dm, now: NOW })
    expect(dm.ingestEvents.mock.calls[0][0].events[0].userData).toBeDefined()
    expect(dm.ingestEvents.mock.calls[1][0].events[0].userData).toBeUndefined()
    expect(updates()[1]).toMatchObject({ status: 'uploaded', requestId: 'req-3' })
    expect(r).toMatchObject({ identifiers: false, status: 'success' })
  })

  it('leaves the queue as it is on a missing scope or another setup problem', async () => {
    for (const err of [
      new DataManagerApiError('Reconnect (DATA_MANAGER_SCOPE_MISSING)', 403, 'PERMISSION_DENIED', SCOPE_MISSING, null, [], false),
      dmError(403, {
        status: 'PERMISSION_DENIED',
        message: 'Data Manager API has not been used in project 1 before or it is disabled.',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com' }],
      }),
      badRequest({ field: 'destinations[0].product_destination_id', reason: 'INVALID_CONVERSION_ACTION_TYPE' }),
    ]) {
      vi.clearAllMocks()
      setDb({ purchases: [due({ id: 1 })], adjustments: [due({ id: 9, kind: 'retraction' })] })
      const dm = fakeDm(() => {
        throw err
      })
      const r = await uploadConversions({ client: fakeAds(() => ({})), dm, now: NOW })
      expect(dm.ingestEvents).toHaveBeenCalledTimes(1)
      expect(updates()).toEqual({})
      expect(r).toMatchObject({ status: 'error', errorCode: err.code, uploaded: 0, retrying: 0, failed: 0 })
      expect(sqlCalls().some(s => s.includes("u.kind <> 'purchase' AND u.next_attempt_at"))).toBe(false)
    }
  })

  it('retries a transient failure with backoff', async () => {
    setDb({ purchases: [due({ id: 1 })] })
    const dm = fakeDm(() => {
      throw dmError(503, { code: 503, status: 'UNAVAILABLE', message: 'The service is currently unavailable.' })
    })
    const r = await uploadConversions({ client: fakeAds(() => ({})), dm, now: NOW })
    expect(updates()[1]).toMatchObject({ status: 'pending', inc: 1, code: 'UNAVAILABLE', nextAt: new Date(NOW.getTime() + 30 * 60_000) })
    expect(r).toMatchObject({ status: 'error', retrying: 1 })
  })

  it('adjusts once Google has the purchase: retractions as value 0, any click id, per conversion action', async () => {
    const old = '2026-10-13T09:00:00Z'
    const other = 'customers/1234567890/conversionActions/555'
    setDb({
      adjustments: [
        due({ id: 11, kind: 'restatement', version: 1, value: '900', adjustment_at: '2026-10-16T01:00:00Z' }),
        due({ id: 12, kind: 'retraction', value: '0', adjustment_at: '2026-10-16T02:00:00Z' }),
        due({ id: 21, order_id: 'o2', order_number: 'ORD-2', kind: 'restatement', version: 1 }),
        due({ id: 31, order_id: 'o3', order_number: 'ORD-3', kind: 'restatement', version: 1, value: '500' }),
        due({ id: 41, order_id: 'o4', order_number: 'ORD-4', kind: 'retraction', value: '0' }),
        due({ id: 51, order_id: 'o5', order_number: 'ORD-5', kind: 'restatement', version: 2, value: '700' }),
      ],
      adjustPurchases: [
        { id: 10, order_id: 'o1', status: 'uploaded', conversion_at: old, uploaded_at: '2026-10-16T05:00:00Z', gclid: 'g1', conversion_action: ACTION, request_id: 'p1', request_status: 'SUCCESS' },
        { id: 20, order_id: 'o2', status: 'uploaded', conversion_at: old, uploaded_at: '2026-10-16T04:00:00Z', gclid: 'g2', conversion_action: ACTION, request_id: 'p2', request_status: 'PROCESSING' },
        { id: 30, order_id: 'o3', status: 'uploaded', conversion_at: old, uploaded_at: old, gclid: null, wbraid: 'w3', conversion_action: ACTION, request_id: 'p3', request_status: 'SUCCESS' },
        { id: 40, order_id: 'o4', status: 'uploaded', conversion_at: old, uploaded_at: old, gclid: 'g4', conversion_action: ACTION, request_id: null },
        { id: 50, order_id: 'o5', status: 'uploaded', conversion_at: old, uploaded_at: old, gclid: 'g5', conversion_action: other, request_id: 'p5', request_status: 'PARTIAL_SUCCESS' },
      ],
    })
    const dm = fakeDm((_b, call) => ({ requestId: `adj-${call}` }))
    const r = await uploadConversions({ client: fakeAds(() => ({})), dm, now: NOW })

    expect(dm.ingestEvents).toHaveBeenCalledTimes(2)
    const [first, second] = dm.ingestEvents.mock.calls.map((c: any) => c[0])
    expect(first.destinations[0].productDestinationId).toBe('777')
    expect(first.events.map((e: any) => [e.transactionId, e.conversionValue])).toEqual([
      ['ORD-1', 0],
      ['ORD-3', 500],
      ['ORD-4', 0],
    ])
    expect(first.events[0]).toMatchObject({ eventTimestamp: '2026-10-13T09:00:00Z', lastUpdatedTimestamp: '2026-10-16T02:00:00Z', adIdentifiers: { gclid: 'g1' } })
    expect(first.events[1].adIdentifiers).toEqual({ wbraid: 'w3' })
    expect(second.destinations[0]).toMatchObject({ operatingAccount: { accountId: '1234567890' }, productDestinationId: '555' })
    expect(second.events.map((e: any) => e.transactionId)).toEqual(['ORD-5'])

    const u = updates()
    expect(u[12]).toMatchObject({ status: 'uploaded', requestId: 'adj-0', action: ACTION, value: 0 })
    expect(u[11]).toMatchObject({ status: 'skipped', code: 'SUPERSEDED' })
    expect(u[31]).toMatchObject({ status: 'uploaded', requestId: 'adj-0' })
    expect(u[51]).toMatchObject({ status: 'uploaded', requestId: 'adj-1', action: other })
    expect(u[21]).toBeUndefined()
    const deferred = callsWith('SET next_attempt_at = $2').find(c => c[1][0] === 21)!
    expect(deferred[1]).toEqual([21, new Date('2026-10-17T04:00:00.000Z')])
    expect(callsWith('INSERT INTO ads_conversion_requests').map(c => c[1].slice(0, 3))).toEqual([
      ['adj-0', 'adjustment', 3],
      ['adj-1', 'adjustment', 1],
    ])
    expect(r.requests).toBe(2)
  })

  it('reads request statuses first and stops at an auth problem there', async () => {
    setDb({ requests: [{ request_id: 'req-old', kind: 'purchase', checks: 0, created_at: '2026-10-16T05:00:00Z' }], purchases: [due({})] })
    const dm = fakeDm(
      () => ({ requestId: 'x' }),
      () => {
        throw new DataManagerApiError('Reconnect', 403, 'PERMISSION_DENIED', SCOPE_MISSING, null, [], false)
      }
    )
    const r = await uploadConversions({ client: fakeAds(() => ({})), dm, now: NOW })
    expect(dm.retrieveRequestStatus).toHaveBeenCalledWith('req-old')
    expect(dm.ingestEvents).not.toHaveBeenCalled()
    expect(r).toMatchObject({ status: 'error', errorCode: SCOPE_MISSING, checked: 0 })
  })
})

describe('uploadConversions through the Google Ads API (fallback)', () => {
  it('uploads due purchases with partial failure and maps each row back', async () => {
    setDb({ api: 'ads_api', purchases: [due({ id: 1 }), due({ id: 2, order_id: 'o2', order_number: 'ORD-2', gclid: 'g2', ads_consent: false })] })
    const ads = fakeAds(() => ({
      jobId: '1790000000',
      results: [{ gclid: 'g1' }, {}],
      partialFailureError: {
        message: 'conversion failed',
        details: [
          {
            '@type': FAILURE,
            errors: [
              {
                errorCode: { conversionUploadError: 'TOO_RECENT_EVENT' },
                message: 'too recent',
                location: { fieldPathElements: [{ fieldName: 'conversions', index: 1 }] },
              },
            ],
          },
        ],
      },
    }))
    const dm = fakeDm(() => ({}))
    const r = await uploadConversions({ client: ads, dm, now: NOW })

    expect(dm.ingestEvents).not.toHaveBeenCalled()
    expect(dm.retrieveRequestStatus).not.toHaveBeenCalled()
    expect(ads.post).toHaveBeenCalledTimes(1)
    const [path, body] = ads.post.mock.calls[0]
    expect(path).toBe(':uploadClickConversions')
    expect(body).toMatchObject({ partialFailure: true, jobId: jobIdFor(NOW) })
    expect(body.conversions).toHaveLength(2)
    expect(body.conversions[0]).toMatchObject({ orderId: 'ORD-1', gclid: 'g1', consent: { adUserData: 'GRANTED' } })
    expect(body.conversions[0].userIdentifiers).toHaveLength(2)
    expect(body.conversions[1]).toMatchObject({ orderId: 'ORD-2', consent: { adUserData: 'DENIED' } })
    expect(body.conversions[1].userIdentifiers).toBeUndefined()

    const u = updates()
    expect(u[1]).toMatchObject({ status: 'uploaded', inc: 1, code: null, action: ACTION, jobId: '1790000000', value: 1180, requestId: null })
    expect(u[2]).toMatchObject({ status: 'pending', inc: 1, code: 'TOO_RECENT_EVENT' })
    expect(u[2].nextAt!.getTime()).toBe(NOW.getTime() + 6 * HOUR)
    expect(r).toMatchObject({ status: 'success', api: 'ads_api', uploaded: 1, retrying: 1, failed: 0, identifiers: true })
  })

  it('leaves identifiers out while enhanced conversions are off in Google Ads', async () => {
    setDb({ api: 'ads_api', purchases: [due({})] })
    const ads = fakeAds(() => ({ results: [{ gclid: 'g1' }] }), 'OFF')
    const r = await uploadConversions({ client: ads, now: NOW })
    expect(ads.post.mock.calls[0][1].conversions[0].userIdentifiers).toBeUndefined()
    expect(r.identifiers).toBe(false)
  })

  it('keeps the batch queued with backoff on a request-level error and stops the run', async () => {
    setDb({ api: 'ads_api', purchases: [due({ id: 1 }), due({ id: 2, attempts: 7 })], adjustments: [due({ id: 9, kind: 'retraction' })] })
    const ads = fakeAds(() => {
      throw new GoogleAdsApiError('not allowlisted', 403, ['CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE'], 'req', false)
    })
    const r = await uploadConversions({ client: ads, now: NOW })
    expect(ads.post).toHaveBeenCalledTimes(1)
    const u = updates()
    expect(u[1]).toMatchObject({ status: 'pending', inc: 1, code: 'CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE' })
    expect(u[1].nextAt!.getTime()).toBe(NOW.getTime() + 30 * 60_000)
    expect(u[1].error).toMatch(/Data Manager API/)
    expect(u[2]).toMatchObject({ status: 'failed' })
    expect(r).toMatchObject({ status: 'error', errorCode: 'CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE', uploaded: 0, failed: 1, retrying: 1 })
    expect(sqlCalls().some(s => s.includes("u.kind <> 'purchase' AND u.next_attempt_at"))).toBe(false)
  })

  it('uploads one adjustment per order once its purchase is in Google, and waits or skips the rest', async () => {
    const old = '2026-10-13T09:00:00Z'
    const purchaseAction = 'customers/1234567890/conversionActions/555'
    setDb({
      api: 'ads_api',
      adjustments: [
        due({ id: 11, kind: 'restatement', version: 1, value: '900', adjustment_at: '2026-10-14T00:00:00Z' }),
        due({ id: 12, kind: 'retraction', value: '0', adjustment_at: '2026-10-15T00:00:00Z' }),
        due({ id: 21, order_id: 'o2', order_number: 'ORD-2', kind: 'restatement', version: 1 }),
        due({ id: 31, order_id: 'o3', order_number: 'ORD-3', kind: 'restatement', version: 1 }),
        due({ id: 41, order_id: 'o4', order_number: 'ORD-4', kind: 'retraction' }),
        due({ id: 51, order_id: 'o5', order_number: 'ORD-5', kind: 'restatement', version: 1 }),
      ],
      adjustPurchases: [
        { id: 10, order_id: 'o1', status: 'uploaded', conversion_at: old, uploaded_at: old, gclid: 'g1', conversion_action: purchaseAction },
        { id: 20, order_id: 'o2', status: 'pending', conversion_at: old, uploaded_at: null, gclid: 'g2' },
        { id: 30, order_id: 'o3', status: 'failed', conversion_at: old, uploaded_at: null, gclid: 'g3' },
        { id: 40, order_id: 'o4', status: 'uploaded', conversion_at: old, uploaded_at: old, gclid: null, wbraid: 'w4' },
        { id: 50, order_id: 'o5', status: 'uploaded', conversion_at: old, uploaded_at: '2026-10-16T04:00:00Z', gclid: 'g5' },
      ],
    })
    const ads = fakeAds(() => ({ results: [{ orderId: 'ORD-1' }] }))
    await uploadConversions({ client: ads, now: NOW })

    expect(ads.post).toHaveBeenCalledTimes(1)
    const [path, body] = ads.post.mock.calls[0]
    expect(path).toBe(':uploadConversionAdjustments')
    expect(body).toMatchObject({ partialFailure: true, jobId: jobIdFor(NOW) })
    expect(body.conversionAdjustments).toEqual([
      { conversionAction: purchaseAction, adjustmentType: 'RETRACTION', orderId: 'ORD-1', adjustmentDateTime: '2026-10-15 05:30:00+05:30' },
    ])
    const u = updates()
    expect(u[12]).toMatchObject({ status: 'uploaded', action: purchaseAction })
    expect(u[11]).toMatchObject({ status: 'skipped', code: 'SUPERSEDED' })
    expect(u[21]).toBeUndefined()
    expect(u[31]).toMatchObject({ status: 'skipped', code: 'NOT_UPLOADED' })
    expect(u[41]).toMatchObject({ status: 'skipped', code: 'WBRAID' })
    const deferred = callsWith('SET next_attempt_at = $2')[0]
    expect(deferred[1]).toEqual([51, new Date('2026-10-16T10:00:00.000Z')])
  })

  it('retries adjustments Google has not matched yet', async () => {
    const old = '2026-10-13T09:00:00Z'
    setDb({
      api: 'ads_api',
      adjustments: [due({ id: 12, kind: 'restatement', version: 1, value: '700', adjustment_at: '2026-10-15T00:00:00Z' })],
      adjustPurchases: [{ id: 10, order_id: 'o1', status: 'uploaded', conversion_at: old, uploaded_at: old, gclid: 'g1' }],
    })
    const ads = fakeAds(() => ({
      results: [{}],
      partialFailureError: {
        message: 'x',
        details: [
          {
            '@type': FAILURE,
            errors: [
              {
                errorCode: { conversionAdjustmentUploadError: 'CONVERSION_NOT_FOUND' },
                message: 'not found',
                location: { fieldPathElements: [{ fieldName: 'conversion_adjustments', index: 0 }] },
              },
            ],
          },
        ],
      },
    }))
    await uploadConversions({ client: ads, now: NOW })
    expect(ads.post.mock.calls[0][1].conversionAdjustments[0]).toMatchObject({
      conversionAction: ACTION,
      restatementValue: { adjustedValue: 700, currencyCode: 'INR' },
    })
    expect(updates()[12]).toMatchObject({ status: 'pending', code: 'CONVERSION_NOT_FOUND', nextAt: new Date(NOW.getTime() + 6 * HOUR) })
  })
})

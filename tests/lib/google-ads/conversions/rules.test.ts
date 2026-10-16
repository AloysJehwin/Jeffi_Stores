import { describe, it, expect } from 'vitest'
import {
  backoffMs,
  canAdjust,
  classifyRowError,
  conversionValue,
  formatAdsDateTime,
  isConverted,
  pickClickIds,
  planConversion,
  requestErrorMessage,
  adjustmentNotBefore,
  classifyEventViolation,
  classifyProcessingError,
  describeReasonCounts,
  dmAdjustmentNotBefore,
  nextPollDelayMs,
  type OrderConversionState,
  type QueueRowLite,
} from '@/lib/google-ads/conversions/rules'

const HOUR = 3_600_000
const NOW = new Date('2026-10-16T06:00:00Z')

const order = (o: Partial<OrderConversionState> = {}): OrderConversionState => ({
  id: 'o1',
  order_number: 'ORD-1',
  status: 'confirmed',
  payment_status: 'paid',
  payment_mode: 'cash',
  total_amount: '1180.00',
  gclid: 'Cj0KCQ',
  gbraid: null,
  wbraid: null,
  attributed_at: '2026-10-15T08:00:00Z',
  created_at: '2026-10-15T09:00:00Z',
  delivered_at: null,
  return_type: null,
  returned_value: null,
  returned_items: null,
  ...o,
})

const row = (r: Partial<QueueRowLite>): QueueRowLite => ({
  kind: 'purchase',
  version: 0,
  value: '1180.00',
  status: 'uploaded',
  conversion_at: '2026-10-15T09:00:00Z',
  adjustment_at: null,
  ...r,
})

describe('conversion value', () => {
  it('is the order total for a live sale', () => {
    expect(conversionValue(order())).toBe(1180)
  })

  it('is 0 once cancelled or refunded', () => {
    expect(conversionValue(order({ status: 'cancelled' }))).toBe(0)
    expect(conversionValue(order({ payment_status: 'refunded' }))).toBe(0)
    expect(conversionValue(order({ payment_status: 'cancelled' }))).toBe(0)
  })

  it('subtracts returned items on a refund return and keeps a replacement', () => {
    expect(conversionValue(order({ status: 'returned', return_type: 'refund', returned_items: 1, returned_value: '400' }))).toBe(780)
    expect(conversionValue(order({ status: 'returned', return_type: 'refund', returned_items: 2, returned_value: '1180' }))).toBe(0)
    expect(conversionValue(order({ status: 'returned', return_type: 'replacement', returned_items: 1, returned_value: '400' }))).toBe(1180)
    expect(conversionValue(order({ status: 'returned', payment_status: 'refunded' }))).toBe(0)
  })
})

describe('isConverted', () => {
  it('counts paid orders and delivered COD orders only', () => {
    expect(isConverted(order())).toBe(true)
    expect(isConverted(order({ payment_status: 'cod_collected', payment_mode: 'cod' }))).toBe(true)
    expect(isConverted(order({ payment_status: 'cod_pending', payment_mode: 'cod' }))).toBe(false)
    expect(isConverted(order({ payment_status: 'cod_pending', payment_mode: 'cod', delivered_at: '2026-10-16T05:00:00Z' }))).toBe(true)
    expect(isConverted(order({ payment_status: 'unpaid' }))).toBe(false)
  })
})

describe('planConversion', () => {
  it('needs a click id', () => {
    expect(planConversion(order({ gclid: null }), [], NOW)).toBeNull()
  })

  it('queues a purchase at the order total, not before 6 hours after the click', () => {
    const p = planConversion(order({ attributed_at: '2026-10-16T03:00:00Z', created_at: '2026-10-16T04:00:00Z' }), [], NOW)!
    expect(p).toMatchObject({ kind: 'purchase', version: 0, value: 1180 })
    expect(p.conversionAt.toISOString()).toBe('2026-10-16T04:00:00.000Z')
    expect(p.nextAttemptAt.toISOString()).toBe('2026-10-16T09:00:00.000Z')
    expect(planConversion(order(), [], NOW)!.nextAttemptAt).toEqual(NOW)
  })

  it('times a COD sale at delivery', () => {
    const p = planConversion(order({ payment_mode: 'cod', payment_status: 'cod_pending', delivered_at: '2026-10-16T02:00:00Z' }), [], NOW)!
    expect(p.conversionAt.toISOString()).toBe('2026-10-16T02:00:00.000Z')
  })

  it('never puts the conversion before the click', () => {
    const p = planConversion(order({ attributed_at: '2026-10-15T09:00:00Z', created_at: '2026-10-15T08:59:00Z' }), [], NOW)!
    expect(p.conversionAt.toISOString()).toBe('2026-10-15T09:00:01.000Z')
  })

  it('queues nothing for an unpaid order or one cancelled before it was queued', () => {
    expect(planConversion(order({ payment_status: 'unpaid' }), [], NOW)).toBeNull()
    expect(planConversion(order({ status: 'cancelled' }), [], NOW)).toBeNull()
  })

  it('is idempotent once the purchase is queued', () => {
    expect(planConversion(order(), [row({ status: 'pending' })], NOW)).toBeNull()
  })

  it('retracts a cancelled order, no sooner than 24 hours after the purchase', () => {
    const p = planConversion(order({ status: 'cancelled' }), [row({})], NOW)!
    expect(p).toMatchObject({ kind: 'retraction', version: 0, value: 0 })
    expect(p.nextAttemptAt.toISOString()).toBe('2026-10-16T09:00:00.000Z')
    expect(p.adjustmentAt!.getTime()).toBeGreaterThan(new Date('2026-10-15T09:00:00Z').getTime())
    expect(planConversion(order({ status: 'cancelled' }), [row({}), row({ kind: 'retraction', value: 0 })], NOW)).toBeNull()
  })

  it('restates a changed value with increasing versions and adjustment times', () => {
    const partial = order({ status: 'returned', return_type: 'refund', returned_items: 1, returned_value: '180' })
    const first = planConversion(partial, [row({})], NOW)!
    expect(first).toMatchObject({ kind: 'restatement', version: 1, value: 1000 })
    const v1 = row({ kind: 'restatement', version: 1, value: '1000', adjustment_at: NOW.toISOString(), status: 'pending' })
    expect(planConversion(partial, [row({}), v1], NOW)).toBeNull()
    const second = planConversion(order({ total_amount: '900' }), [row({}), v1], NOW)!
    expect(second).toMatchObject({ kind: 'restatement', version: 2, value: 900 })
    expect(second.adjustmentAt!.getTime()).toBe(NOW.getTime() + 1000)
  })
})

describe('click ids', () => {
  it('sends gclid (with gbraid when present), else gbraid, else wbraid; never gbraid with wbraid', () => {
    expect(pickClickIds({ gclid: 'g', gbraid: 'b', wbraid: 'w' })).toEqual({ gclid: 'g', gbraid: 'b' })
    expect(pickClickIds({ gbraid: 'b', wbraid: 'w' })).toEqual({ gbraid: 'b' })
    expect(pickClickIds({ wbraid: 'w' })).toEqual({ wbraid: 'w' })
  })

  it('cannot adjust a wbraid-only conversion', () => {
    expect(canAdjust({ wbraid: 'w' })).toBe(false)
    expect(canAdjust({ gbraid: 'b' })).toBe(true)
  })
})

describe('formatAdsDateTime', () => {
  it("uses Google's format with the zone offset", () => {
    expect(formatAdsDateTime(new Date('2026-10-15T20:31:05.900Z'), 'Asia/Kolkata')).toBe('2026-10-16 02:01:05+05:30')
    expect(formatAdsDateTime(new Date('2026-10-15T20:31:05Z'), 'America/New_York')).toBe('2026-10-15 16:31:05-04:00')
    expect(formatAdsDateTime(new Date('2026-10-15T20:31:05Z'), 'Bad/Zone')).toBe('2026-10-16 02:01:05+05:30')
  })
})

describe('error handling rules', () => {
  it('waits on too-recent clicks and adjustments', () => {
    expect(classifyRowError('purchase', 'TOO_RECENT_EVENT')).toMatchObject({ outcome: 'retry', delayMs: 6 * HOUR })
    expect(classifyRowError('retraction', 'TOO_RECENT_CONVERSION')).toMatchObject({ outcome: 'retry', delayMs: 24 * HOUR })
    expect(classifyRowError('restatement', 'TOO_RECENT_CONVERSION_ACTION')).toMatchObject({ outcome: 'retry', delayMs: 6 * HOUR })
  })

  it('treats a duplicate order id as already uploaded and dead clicks as skipped', () => {
    expect(classifyRowError('purchase', 'ORDER_ID_ALREADY_IN_USE').outcome).toBe('uploaded')
    expect(classifyRowError('purchase', 'EXPIRED_EVENT').outcome).toBe('skipped')
    expect(classifyRowError('retraction', 'CONVERSION_ALREADY_RETRACTED').outcome).toBe('skipped')
  })

  it('fails unknown codes with Google message and the code', () => {
    expect(classifyRowError('purchase', 'SOMETHING_NEW', 'Bad thing')).toEqual({ outcome: 'failed', delayMs: 0, message: 'Bad thing (SOMETHING_NEW)' })
    expect(classifyRowError('purchase', 'NO_CONVERSION_ACTION_FOUND').message).toMatch(/Pick another one/)
  })

  it('backs off from 30 minutes up to a day', () => {
    expect([1, 2, 3, 6, 12].map(backoffMs)).toEqual([30 * 60_000, HOUR, 2 * HOUR, 16 * HOUR, 24 * HOUR])
  })

  it('explains the June 2026 upload restriction', () => {
    expect(requestErrorMessage(['CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE'], 'x')).toMatch(/Data Manager API/)
    expect(requestErrorMessage([], 'Plain')).toBe('Plain')
  })

  it('waits a day after the conversion and 6 hours after upload before adjusting', () => {
    expect(adjustmentNotBefore({ conversion_at: '2026-10-15T00:00:00Z', uploaded_at: '2026-10-15T23:00:00Z' }).toISOString()).toBe(
      '2026-10-16T05:00:00.000Z'
    )
    expect(adjustmentNotBefore({ conversion_at: '2026-10-15T00:00:00Z', uploaded_at: null }).toISOString()).toBe('2026-10-16T00:00:00.000Z')
  })
})

describe('Data Manager rules', () => {
  it('adjusts once Google confirmed the purchase request, else a day after the upload', () => {
    const p = { conversion_at: '2026-10-15T09:00:00Z', uploaded_at: '2026-10-16T04:00:00Z', request_id: 'r' }
    expect(dmAdjustmentNotBefore({ ...p, request_status: 'SUCCESS' })).toEqual(new Date('2026-10-16T04:00:00Z'))
    expect(dmAdjustmentNotBefore({ ...p, request_status: 'PARTIAL_SUCCESS' })).toEqual(new Date('2026-10-16T04:00:00Z'))
    expect(dmAdjustmentNotBefore({ ...p, request_status: 'PROCESSING' })).toEqual(new Date('2026-10-17T04:00:00Z'))
    expect(dmAdjustmentNotBefore({ ...p, request_status: null })).toEqual(new Date('2026-10-17T04:00:00Z'))
    // Sent with the Google Ads API before: its rules.
    expect(dmAdjustmentNotBefore({ ...p, request_id: null })).toEqual(adjustmentNotBefore(p))
  })

  it("polls on Google's schedule: 39, 51, then hourly", () => {
    expect(nextPollDelayMs(1)).toBe(39 * 60_000)
    expect(nextPollDelayMs(2)).toBe(Math.round(50.7 * 60_000))
    expect(nextPollDelayMs(3)).toBe(60 * 60_000)
    expect(nextPollDelayMs(25)).toBe(60 * 60_000)
  })

  it('maps processing errors: retry too-recent clicks, count duplicates as uploaded, skip dead clicks', () => {
    expect(classifyProcessingError('PROCESSING_ERROR_REASON_TOO_RECENT_CLICK')).toMatchObject({ outcome: 'retry', delayMs: 6 * HOUR })
    expect(classifyProcessingError('PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID').outcome).toBe('uploaded')
    expect(classifyProcessingError('PROCESSING_ERROR_REASON_EXPIRED_CLICK').outcome).toBe('skipped')
    expect(classifyProcessingError('PROCESSING_ERROR_REASON_DENIED_CONSENT').message).toMatch(/declined advertising cookies/)
    expect(classifyProcessingError('PROCESSING_ERROR_REASON_NEW_THING')).toMatchObject({
      outcome: 'failed',
      message: 'Google rejected it: New thing (PROCESSING_ERROR_REASON_NEW_THING)',
    })
  })

  it('maps fast-fail violations on one event', () => {
    expect(classifyEventViolation({ reason: 'EVENT_TIME_INVALID' }).outcome).toBe('skipped')
    expect(classifyEventViolation({ reason: 'INVALID_AD_IDENTIFIER_FOR_ACCOUNT' }).outcome).toBe('skipped')
    expect(classifyEventViolation({ reason: 'INVALID_SHA256_FORMAT', description: 'bad hash' })).toEqual({
      outcome: 'failed',
      delayMs: 0,
      message: 'bad hash (INVALID_SHA256_FORMAT)',
    })
  })

  it('summarises reason counts', () => {
    expect(describeReasonCounts([{ reason: 'PROCESSING_ERROR_REASON_EXPIRED_CLICK', count: 2 }, { reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', count: 1 }])).toBe(
      'Expired click x2, Internal error x1'
    )
  })
})

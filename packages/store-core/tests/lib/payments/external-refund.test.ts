import { describe, it, expect } from 'vitest'
import {
  EXTERNAL_REFUND_METHODS,
  RAZORPAY_ONLY_METHODS,
  externalRefundLabel,
  parseExternalRefund,
} from '@/lib/payments/external-refund'

describe('externalRefundLabel', () => {
  it('maps known methods to their labels', () => {
    expect(externalRefundLabel('cash')).toBe('Cash')
    expect(externalRefundLabel('razorpay_dispute')).toBe(EXTERNAL_REFUND_METHODS.razorpay_dispute)
  })
  it('falls back to the raw string when non-empty and unknown', () => {
    expect(externalRefundLabel('mystery')).toBe('mystery')
  })
  it("defaults to 'Other' for non-strings / empties", () => {
    expect(externalRefundLabel('')).toBe('Other')
    expect(externalRefundLabel(null)).toBe('Other')
    expect(externalRefundLabel(42)).toBe('Other')
  })
})

describe('RAZORPAY_ONLY_METHODS', () => {
  it('contains exactly the Razorpay chargeback/dashboard methods', () => {
    expect(RAZORPAY_ONLY_METHODS).toEqual(['razorpay_dispute', 'razorpay_dashboard'])
  })
})

describe('parseExternalRefund', () => {
  it('rejects a missing/unknown method', () => {
    expect(parseExternalRefund({})).toBe('Choose how the refund was made.')
    expect(parseExternalRefund({ method: 'nope' })).toBe('Choose how the refund was made.')
    expect(parseExternalRefund(null)).toBe('Choose how the refund was made.')
  })
  it('trims and caps reference and note', () => {
    const r = parseExternalRefund({ method: 'bank_transfer', reference: '  R123  ', note: '  hi  ' })
    expect(r).toEqual({ method: 'bank_transfer', reference: 'R123', note: 'hi' })
  })
  it('caps reference at 120 and note at 500 chars', () => {
    const r = parseExternalRefund({ method: 'upi', reference: 'x'.repeat(200), note: 'y'.repeat(600) }) as any
    expect(r.reference).toHaveLength(120)
    expect(r.note).toHaveLength(500)
  })
  it('nulls empty-after-trim strings and non-strings', () => {
    const r = parseExternalRefund({ method: 'cash', reference: '   ', note: 123 })
    expect(r).toEqual({ method: 'cash', reference: null, note: null })
  })
  it("requires a note when method is 'other'", () => {
    expect(parseExternalRefund({ method: 'other' })).toBe('Add a note saying how the refund was made.')
    const ok = parseExternalRefund({ method: 'other', note: 'returned in store' })
    expect(ok).toEqual({ method: 'other', reference: null, note: 'returned in store' })
  })
})

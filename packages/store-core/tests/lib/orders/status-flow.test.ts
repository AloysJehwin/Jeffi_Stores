import { describe, it, expect } from 'vitest'
import {
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_TRANSITIONS,
  PAYMENT_ALLOWED_FOR_STATUS,
  orderLockedError,
  orderTransitionError,
  paymentStatusError,
  manualPaymentStatusError,
  REFUND_NEEDS_REFUND,
} from '@/lib/orders/status-flow'

describe('status tables', () => {
  it('declares the expected statuses', () => {
    expect(ORDER_STATUSES).toContain('delivered')
    expect(PAYMENT_STATUSES).toEqual(['pending', 'unpaid', 'paid', 'failed', 'refunded', 'cod_pending', 'cod_collected'])
    expect(ORDER_STATUS_TRANSITIONS.granted).toEqual([])
    expect(PAYMENT_ALLOWED_FOR_STATUS.delivered).toEqual(['paid', 'cod_collected'])
  })
})

describe('orderLockedError', () => {
  it('blocks terminal statuses', () => {
    for (const s of TERMINAL_ORDER_STATUSES) {
      expect(orderLockedError(s)).toBe(`Orders with status '${s}' cannot be modified`)
    }
  })
  it('allows non-terminal', () => {
    expect(orderLockedError('pending')).toBeNull()
    expect(orderLockedError('shipped')).toBeNull()
  })
})

describe('orderTransitionError', () => {
  it('allows a same-status write', () => {
    expect(orderTransitionError('shipped', 'shipped')).toBeNull()
  })
  it('allows a declared transition', () => {
    expect(orderTransitionError('pending', 'confirmed')).toBeNull()
    expect(orderTransitionError('shipped', 'delivered')).toBeNull()
  })
  it('rejects an undeclared transition', () => {
    expect(orderTransitionError('pending', 'shipped')).toBe("Cannot transition order from 'pending' to 'shipped'")
  })
  it('rejects a transition from an unknown status (empty list)', () => {
    expect(orderTransitionError('granted', 'delivered')).toBe("Cannot transition order from 'granted' to 'delivered'")
    expect(orderTransitionError('nonexistent', 'confirmed')).toBe("Cannot transition order from 'nonexistent' to 'confirmed'")
  })
})

describe('paymentStatusError', () => {
  it('rejects a value outside the allowed set', () => {
    expect(paymentStatusError('pending', 'bogus', false)).toBe('Invalid payment status: bogus')
    expect(paymentStatusError('pending', 'paid', false, ['pending'])).toBe('Invalid payment status: paid')
  })
  it('blocks paid → pending without override', () => {
    expect(paymentStatusError('paid', 'pending', false)).toBe('Paid orders cannot revert to pending. Use refunded instead.')
  })
  it('permits paid → pending with override', () => {
    expect(paymentStatusError('paid', 'pending', true)).toBeNull()
  })
  it('permits an ordinary move', () => {
    expect(paymentStatusError('pending', 'paid', false)).toBeNull()
  })
})

describe('manualPaymentStatusError', () => {
  it('returns the base error when paymentStatusError fails', () => {
    expect(manualPaymentStatusError('pending', 'bogus', false)).toBe('Invalid payment status: bogus')
  })
  it('short-circuits on override', () => {
    // refunded would otherwise be blocked; override lets any valid target through
    expect(manualPaymentStatusError('paid', 'refunded', true)).toBeNull()
  })
  it('short-circuits on a same-status write', () => {
    expect(manualPaymentStatusError('paid', 'paid', false)).toBeNull()
  })
  it('blocks a bare refunded with the refund message', () => {
    expect(manualPaymentStatusError('paid', 'refunded', false)).toBe(REFUND_NEEDS_REFUND)
  })
  it('allows a declared manual move', () => {
    expect(manualPaymentStatusError('pending', 'paid', false)).toBeNull()
    expect(manualPaymentStatusError('cod_pending', 'cod_collected', false)).toBeNull()
  })
  it('rejects an undeclared manual move', () => {
    expect(manualPaymentStatusError('pending', 'cod_collected', false)).toBe("Cannot move payment from 'pending' to 'cod_collected'")
  })
  it('rejects a move from a status with no declared transitions', () => {
    // 'paid' allows only 'refunded', which is diverted above; a non-refunded target hits the table
    expect(manualPaymentStatusError('paid', 'failed', false)).toBe("Cannot move payment from 'paid' to 'failed'")
  })
  it('uses PAYMENT_STATUS_TRANSITIONS as reference', () => {
    expect(PAYMENT_STATUS_TRANSITIONS.failed).toEqual(['paid', 'pending'])
  })
})

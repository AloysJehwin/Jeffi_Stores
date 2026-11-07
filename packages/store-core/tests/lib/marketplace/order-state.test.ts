import { describe, it, expect } from 'vitest'
import { decideTransition, ourOrderStatus, paymentStatusFor, stockAction } from '@/lib/marketplace/order-state'

describe('marketplace order state', () => {
  it('maps marketplace statuses to ours', () => {
    expect(['created', 'accepted', 'packed', 'ready_to_dispatch', 'shipped', 'delivered', 'cancelled', 'rejected', 'returned'].map(s => ourOrderStatus(s as any))).toEqual([
      'pending',
      'confirmed',
      'processing',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'cancelled',
      'return_requested',
    ])
    expect([paymentStatusFor('created'), paymentStatusFor('accepted'), paymentStatusFor('rejected')]).toEqual(['pending', 'paid', 'unpaid'])
  })

  it('deducts on accept, restores on cancel or reject, each once', () => {
    expect(stockAction('created', 'none')).toBe('none')
    expect(stockAction('accepted', 'none')).toBe('deduct')
    expect(stockAction('shipped', 'short')).toBe('deduct')
    expect(stockAction('packed', 'deducted')).toBe('none')
    expect(stockAction('cancelled', 'deducted')).toBe('restore')
    expect(stockAction('rejected', 'deducted')).toBe('restore')
    expect(stockAction('cancelled', 'none')).toBe('none')
    expect(stockAction('cancelled', 'restored')).toBe('none')
    expect(stockAction('accepted', 'unmatched')).toBe('none')
    expect(stockAction('returned', 'deducted')).toBe('none')
  })

  it('applies progress and ignores stale events', () => {
    expect(decideTransition(null, { status: 'accepted' })).toEqual({ apply: true, status: 'accepted', changed: true })
    expect(decideTransition({ status: 'created' }, { status: 'packed' })).toMatchObject({ apply: true, status: 'packed', changed: true })
    expect(decideTransition({ status: 'packed' }, { status: 'accepted' })).toMatchObject({ apply: false, status: 'packed' })
    expect(decideTransition({ status: 'cancelled' }, { status: 'rejected' })).toMatchObject({ apply: false })
  })

  it('refreshes the same status unless the event is older', () => {
    const prior = { status: 'shipped' as const, eventAt: '2026-11-01T10:00:00Z' }
    expect(decideTransition(prior, { status: 'shipped', eventAt: '2026-11-01T11:00:00Z' })).toEqual({ apply: true, status: 'shipped', changed: false })
    expect(decideTransition(prior, { status: 'shipped', eventAt: '2026-11-01T09:00:00Z' }).apply).toBe(false)
  })

  it('treats a cancel after shipping as a return', () => {
    expect(decideTransition({ status: 'shipped' }, { status: 'cancelled' })).toMatchObject({ apply: true, status: 'returned' })
    expect(decideTransition({ status: 'accepted' }, { status: 'cancelled' })).toMatchObject({ apply: true, status: 'cancelled' })
  })
})

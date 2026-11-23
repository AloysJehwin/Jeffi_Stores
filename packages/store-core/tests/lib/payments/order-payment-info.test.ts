import { describe, it, expect, vi } from 'vitest'

const queryMany = vi.fn<(...a: any[]) => Promise<any>>(async () => [])
vi.mock('@/lib/shared/db', () => ({ queryMany: (...a: any[]) => queryMany(...a) }))

import { orderRefunds, orderDisputes, paidWith } from '@/lib/payments/order-payment-info'

describe('paidWith (pure)', () => {
  it('upi with and without vpa', () => {
    expect(paidWith({ gateway_method: 'upi', vpa: 'a@ybl' })).toBe('UPI · a@ybl')
    expect(paidWith({ gateway_method: 'upi' })).toBe('UPI')
  })
  it('card network/type/last4, and bare Card fallback', () => {
    expect(paidWith({ gateway_method: 'card', card_network: 'Visa', card_type: 'credit', card_last4: '4242' })).toBe('Visa credit ••4242')
    // empty join -> '' which is falsy -> 'Card'
    expect(paidWith({ gateway_method: 'card' })).toBe('Card')
    expect(paidWith({ gateway_method: 'card', card_last4: '0001' })).toBe(' ••0001')
  })
  it('netbanking with/without bank', () => {
    expect(paidWith({ gateway_method: 'netbanking', bank: 'HDFC' })).toBe('Net banking · HDFC')
    expect(paidWith({ gateway_method: 'netbanking' })).toBe('Net banking')
  })
  it('wallet with/without name', () => {
    expect(paidWith({ gateway_method: 'wallet', wallet: 'Paytm' })).toBe('Wallet · Paytm')
    expect(paidWith({ gateway_method: 'wallet' })).toBe('Wallet')
  })
  it('emi, unknown method, and null', () => {
    expect(paidWith({ gateway_method: 'emi' })).toBe('EMI')
    expect(paidWith({ gateway_method: 'something' })).toBe('something')
    expect(paidWith({})).toBeNull()
    expect(paidWith({ gateway_method: null })).toBeNull()
  })
})

describe('orderRefunds', () => {
  it('passes order ids and returns rows', async () => {
    const rows = [{ id: 'r1' }]
    queryMany.mockResolvedValueOnce(rows as any)
    const out = await orderRefunds(['o1', 'o2'])
    expect(out).toBe(rows)
    const [sql, args] = queryMany.mock.calls.at(-1)!
    expect(sql).toContain('FROM payment_refunds')
    expect(args).toEqual([['o1', 'o2']])
  })
  it('swallows errors to []', async () => {
    queryMany.mockRejectedValueOnce(new Error('db'))
    expect(await orderRefunds(['o1'])).toEqual([])
  })
})

describe('orderDisputes', () => {
  it('passes order ids and returns rows', async () => {
    const rows = [{ id: 'd1' }]
    queryMany.mockResolvedValueOnce(rows as any)
    const out = await orderDisputes(['o1'])
    expect(out).toBe(rows)
    const [sql, args] = queryMany.mock.calls.at(-1)!
    expect(sql).toContain('FROM payment_disputes')
    expect(args).toEqual([['o1']])
  })
  it('swallows errors to []', async () => {
    queryMany.mockRejectedValueOnce(new Error('db'))
    expect(await orderDisputes(['o1'])).toEqual([])
  })
})

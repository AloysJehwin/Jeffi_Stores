import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

import { logMessage } from '@/lib/message-log'
import { query } from '@/lib/db'

const mockQuery = vi.mocked(query)

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue({ rows: [] } as any)
})

describe('logMessage', () => {
  it('inserts OTP messages but redacts the code in the body', () => {
    logMessage({
      channel: 'sms',
      to: '+919876543210',
      from: '+18722179910',
      body: 'Your OTP is 123456',
      kind: 'otp',
      status: 'sent',
    })
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, values] = mockQuery.mock.calls[0]!
    expect(sql).toContain('INSERT INTO message_logs')
    // The code itself is masked; the surrounding wording is preserved.
    expect(values![4]).toBe('Your OTP is ••••••')
    expect(values![4]).not.toContain('123456')
    expect(values![5]).toBe('otp')
  })

  it('inserts a normal message with correct params and defaults direction to outbound', () => {
    logMessage({
      channel: 'sms',
      to: '+919876543210',
      from: '+18722179910',
      body: 'Order confirmed',
      kind: 'order_confirmed',
      status: 'sent',
      providerSid: 'SM1',
    })
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, values] = mockQuery.mock.calls[0]!
    expect(sql).toContain('INSERT INTO message_logs')
    expect(values).toEqual([
      'sms',
      'outbound',
      '+919876543210',
      '+18722179910',
      'Order confirmed',
      'order_confirmed',
      'sent',
      null, // error default
      'SM1',
      null, // userId default
      null, // entityType default
      null, // entityId default
    ])
  })

  it('passes entityType/entityId through to the INSERT params when provided', () => {
    logMessage({
      channel: 'whatsapp',
      to: '+919876543210',
      from: '+18722179910',
      body: 'We miss you!',
      kind: 'winback_90',
      status: 'sent',
      entityType: 'campaign',
      entityId: 'winback_90',
    })
    const [, values] = mockQuery.mock.calls[0]!
    expect(values![10]).toBe('campaign')
    expect(values![11]).toBe('winback_90')
  })

  it('defaults entityType/entityId to null when omitted', () => {
    logMessage({
      channel: 'whatsapp',
      to: '+919876543210',
      from: '+18722179910',
      body: 'hi',
      kind: 'promo_offer',
      status: 'sent',
    })
    const [, values] = mockQuery.mock.calls[0]!
    expect(values![10]).toBeNull()
    expect(values![11]).toBeNull()
  })

  it('passes inbound direction through when provided', () => {
    logMessage({
      channel: 'whatsapp',
      direction: 'inbound',
      to: '+18722179910',
      from: '+919876543210',
      body: 'hi',
      kind: 'inbound',
      status: 'received',
      userId: 'user-1',
    })
    const [, values] = mockQuery.mock.calls[0]!
    expect(values![1]).toBe('inbound')
    expect(values![9]).toBe('user-1')
  })

  it('passes through error and null body', () => {
    logMessage({
      channel: 'sms',
      to: '+919876543210',
      from: '+18722179910',
      body: null,
      kind: 'order_shipped',
      status: 'failed',
      error: 'boom',
    })
    const [, values] = mockQuery.mock.calls[0]!
    expect(values![4]).toBeNull()
    expect(values![7]).toBe('boom')
  })

  it('swallows a rejected query (fire-and-forget, never throws)', () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    expect(() =>
      logMessage({
        channel: 'sms',
        to: '+919876543210',
        from: '+18722179910',
        body: 'x',
        kind: 'order_delivered',
        status: 'sent',
      })
    ).not.toThrow()
  })
})

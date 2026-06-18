/**
 * Tests for GET /api/support/bot
 * src/app/api/support/bot/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── hoisted env + mocks ───────────────────────────────────────────────────────
const mockAuthenticateAnyUser = vi.hoisted(() => vi.fn())
const mockQueryMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: mockAuthenticateAnyUser,
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: mockQueryMany,
  withTransaction: vi.fn(),
}))

import { GET } from '@/app/api/support/bot/route'

// ── helpers ───────────────────────────────────────────────────────────────────
function makeRequest(msg: string, headers: Record<string, string> = {}) {
  const url = `http://localhost/api/support/bot?msg=${encodeURIComponent(msg)}`
  return new NextRequest(url, { method: 'GET', headers })
}

const SAMPLE_ORDER = {
  order_number: 'ORD-001',
  status: 'shipped',
  payment_status: 'paid',
  total_amount: '1500',
  tracking_number: 'TRACK123',
  created_at: new Date('2026-01-01').toISOString(),
}

const AUTH_USER = { userId: 'user-1', email: 'user@example.com' }

// ── tests ─────────────────────────────────────────────────────────────────────
describe('GET /api/support/bot', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns session-expired reply when not authenticated', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(null)
    const res = await GET(makeRequest('hello') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/session has expired/i)
  })

  it('returns prompt-to-start reply when msg is empty', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    const res = await GET(makeRequest('   ') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/select a topic/i)
  })

  it('returns error reply on db failure', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockRejectedValue(new Error('db down'))
    const res = await GET(makeRequest('track my order') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/trouble fetching/i)
  })

  it('responds to track/shipping keyword with tracking number', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([SAMPLE_ORDER])
    const res = await GET(makeRequest('track my order') as any)
    const body = await res.json()
    expect(body.reply).toContain('TRACK123')
    expect(body.reply).toContain('ORD-001')
  })

  it('responds to shipped keyword with shipped status when no tracking number', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([{ ...SAMPLE_ORDER, tracking_number: null }])
    const res = await GET(makeRequest('shipped') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/shipped/i)
  })

  it('responds to shipping keyword with status when not yet shipped', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([{ ...SAMPLE_ORDER, status: 'processing', tracking_number: null }])
    const res = await GET(makeRequest('shipping') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/processing/i)
  })

  it('responds to track keyword with no-orders message when empty', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('track') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/don't have any orders/i)
  })

  it('responds to payment keyword with payment info', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([SAMPLE_ORDER])
    const res = await GET(makeRequest('payment status') as any)
    const body = await res.json()
    expect(body.reply).toContain('paid')
    expect(body.reply).toMatch(/1,500|1500/)
  })

  it('responds to payment keyword with no-orders when empty', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('invoice') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/don't have any orders/i)
  })

  it('responds to cancel keyword', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('cancel my order') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/cancellation/i)
  })

  it('responds to refund keyword', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('refund please') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/refund/i)
  })

  it('responds to order status keyword with latest order details', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([SAMPLE_ORDER])
    const res = await GET(makeRequest('order status') as any)
    const body = await res.json()
    expect(body.reply).toContain('ORD-001')
    expect(body.reply).toMatch(/shipped/i)
  })

  it('responds to order keyword with no-orders when empty', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('latest order') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/don't have any orders/i)
  })

  it('responds to return keyword', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('return item') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/return/i)
  })

  it('responds to exchange keyword', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('exchange product') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/return/i)
  })

  it('responds to delivery keyword', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('delivery time') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/delivery/i)
  })

  it('responds to hello keyword', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('hello') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/hello|hi/i)
  })

  it('responds to hi keyword', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('hi there') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/hello|hi/i)
  })

  it('returns fallback reply for unknown message', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('xyzzy gobbledygook') as any)
    const body = await res.json()
    expect(body.reply).toMatch(/not sure|support agent/i)
  })
})

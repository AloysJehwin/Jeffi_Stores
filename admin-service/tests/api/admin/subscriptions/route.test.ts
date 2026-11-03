import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/queries/subscriptions', () => ({
  listAdminSubscriptions: vi.fn(),
  getAdminSubscriptionStats: vi.fn(),
  getAdminSubscriptionDetail: vi.fn(),
}))
vi.mock('@/lib/subscriptions/service', () => {
  class SubscriptionError extends Error {
    constructor(
      message: string,
      public status: number
    ) {
      super(message)
    }
  }
  return {
    SubscriptionError,
    cancelSubscription: vi.fn(),
    pauseSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
    syncSubscription: vi.fn(),
  }
})

import { GET as LIST } from '@admin/app/api/(admin)/admin/subscriptions/route'
import { GET, POST } from '@admin/app/api/(admin)/admin/subscriptions/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { getScopeForPath } from '@/lib/auth/scopes'
import {
  listAdminSubscriptions,
  getAdminSubscriptionStats,
  getAdminSubscriptionDetail,
} from '@/lib/queries/subscriptions'
import {
  SubscriptionError,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  syncSubscription,
} from '@/lib/subscriptions/service'

const mockAuth = authenticateAdmin as ReturnType<typeof vi.fn>
const mockList = listAdminSubscriptions as ReturnType<typeof vi.fn>
const mockStats = getAdminSubscriptionStats as ReturnType<typeof vi.fn>
const mockDetail = getAdminSubscriptionDetail as ReturnType<typeof vi.fn>

const reader = { adminId: 'a1', role: 'admin', scopes: ['subscriptions:read'] }
const writer = { adminId: 'a1', role: 'admin', scopes: ['subscriptions:write'] }
const ctx = { params: Promise.resolve({ id: 'sub1' }) }
const detail = { subscription: { id: 'sub1' }, customer: null, product: null, cycles: [] }

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/subscriptions/sub1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('admin subscriptions API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    mockStats.mockResolvedValue({ active: 2, paused: 1, halted: 0, cancelled: 3, mrr: 1234.5 })
    mockDetail.mockResolvedValue(detail)
  })

  it('maps the API prefix to subscriptions:read', () => {
    expect(getScopeForPath('/api/admin/subscriptions')).toBe('subscriptions:read')
    expect(getScopeForPath('/api/admin/subscriptions/abc')).toBe('subscriptions:read')
  })

  describe('GET list', () => {
    it('401 when unauthenticated', async () => {
      mockAuth.mockResolvedValue(null)
      const res = await LIST(new NextRequest('http://localhost/api/admin/subscriptions'))
      expect(res.status).toBe(401)
    })

    it('403 without subscriptions:read', async () => {
      mockAuth.mockResolvedValue({ ...reader, scopes: ['orders:read'] })
      const res = await LIST(new NextRequest('http://localhost/api/admin/subscriptions'))
      expect(res.status).toBe(403)
    })

    it('passes status, q and page through and returns stats', async () => {
      mockAuth.mockResolvedValue(reader)
      const res = await LIST(new NextRequest('http://localhost/api/admin/subscriptions?status=paused&q=asha&page=3'))
      expect(res.status).toBe(200)
      expect(mockList).toHaveBeenCalledWith({ status: 'paused', q: 'asha', page: 3 })
      const body = await res.json()
      expect(body.stats.mrr).toBe(1234.5)
      expect(body).toMatchObject({ items: [], total: 0, page: 1, pageSize: 25 })
    })

    it('write scope implies read', async () => {
      mockAuth.mockResolvedValue(writer)
      const res = await LIST(new NextRequest('http://localhost/api/admin/subscriptions'))
      expect(res.status).toBe(200)
    })
  })

  describe('GET detail', () => {
    it('404 when missing', async () => {
      mockAuth.mockResolvedValue(reader)
      mockDetail.mockResolvedValue(null)
      const res = await GET(new NextRequest('http://localhost/api/admin/subscriptions/sub1'), ctx)
      expect(res.status).toBe(404)
    })

    it('returns the detail', async () => {
      mockAuth.mockResolvedValue(reader)
      const res = await GET(new NextRequest('http://localhost/api/admin/subscriptions/sub1'), ctx)
      expect(await res.json()).toEqual(detail)
    })
  })

  describe('POST actions', () => {
    it('403 for a read-only admin', async () => {
      mockAuth.mockResolvedValue(reader)
      const res = await POST(post({ action: 'pause' }), ctx)
      expect(res.status).toBe(403)
      expect(pauseSubscription).not.toHaveBeenCalled()
    })

    it('400 for an unknown action', async () => {
      mockAuth.mockResolvedValue(writer)
      const res = await POST(post({ action: 'toString' }), ctx)
      expect(res.status).toBe(400)
    })

    it.each([
      ['cancel_now', () => expect(cancelSubscription).toHaveBeenCalledWith('sub1', { atCycleEnd: false, actor: 'admin' })],
      ['cancel_at_end', () => expect(cancelSubscription).toHaveBeenCalledWith('sub1', { atCycleEnd: true, actor: 'admin' })],
      ['pause', () => expect(pauseSubscription).toHaveBeenCalledWith('sub1', 'admin')],
      ['resume', () => expect(resumeSubscription).toHaveBeenCalledWith('sub1')],
      ['sync', () => expect(syncSubscription).toHaveBeenCalledWith('sub1')],
    ])('%s calls the service and returns fresh detail', async (action, check) => {
      mockAuth.mockResolvedValue(writer)
      const res = await POST(post({ action }), ctx)
      expect(res.status).toBe(200)
      check()
      expect(await res.json()).toEqual(detail)
    })

    it('surfaces SubscriptionError status', async () => {
      mockAuth.mockResolvedValue(writer)
      ;(pauseSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(
        new (SubscriptionError as any)('Only active subscriptions can be paused', 409)
      )
      const res = await POST(post({ action: 'pause' }), ctx)
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/active/)
    })

    it('502 on an unexpected failure', async () => {
      mockAuth.mockResolvedValue(writer)
      ;(syncSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('razorpay down'))
      const res = await POST(post({ action: 'sync' }), ctx)
      expect(res.status).toBe(502)
    })
  })
})

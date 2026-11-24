import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ authenticateAdmin: vi.fn(), last: vi.fn(), running: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: m.authenticateAdmin }))
vi.mock('@/lib/amazon/sync', () => ({ getLastAmazonSyncStatus: m.last, isAmazonSyncRunning: m.running }))

import { GET } from '@admin/app/api/(admin)/admin/merchant/amazon/status/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:read'] }
const get = () => GET(new NextRequest('https://acme.jeffistores.in/api/admin/merchant/amazon/status'))

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAdmin.mockResolvedValue(ADMIN)
  m.last.mockResolvedValue({ finishedAt: '2026-11-20T10:00:00Z', pushed: 40, errors: [] })
  m.running.mockResolvedValue(false)
})

describe('merchant amazon status route', () => {
  it('answers 401 signed out and 403 without merchant_sync:read', async () => {
    m.authenticateAdmin.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    m.authenticateAdmin.mockResolvedValue({ ...ADMIN, scopes: ['orders:read'] })
    const res = await get()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
    expect(m.last).not.toHaveBeenCalled()
  })

  it('returns the last sync and whether one is running', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: { finishedAt: '2026-11-20T10:00:00Z', pushed: 40, errors: [] }, running: false })
    m.running.mockResolvedValue(true)
    expect((await (await get()).json()).running).toBe(true)
  })

  it('returns a null status when nothing has synced yet', async () => {
    m.last.mockResolvedValue(undefined)
    expect(await (await get()).json()).toEqual({ status: null, running: false })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  sql: [] as string[],
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/google-ads/notify', () => ({ readSetting: m.read, writeSettings: m.write }))
vi.mock('@/lib/amazon/orders', () => ({ SETTING_ORDERS: 'amazon_orders_import' }))
vi.mock('@/lib/amazon/stock', () => ({ SETTING_STOCK: 'amazon_stock_push', SETTING_BUFFER: 'amazon_stock_buffer' }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(async (sql: string) => (m.sql.push(sql), { rows: [] })),
  queryOne: vi.fn(async (sql: string) => (m.sql.push(sql), { id: 'log1' })),
  queryMany: vi.fn(async () => []),
}))

import { PUT } from '@admin/app/api/(admin)/admin/amazon/orders-settings/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon_orders:write'] }
const put = (body: unknown) =>
  PUT(new NextRequest('https://acme.jeffistores.in/api/admin/amazon/orders-settings', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
const deny = (status: number) => NextResponse.json({ error: 'nope' }, { status })

beforeEach(() => {
  vi.clearAllMocks()
  m.sql = []
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.read.mockImplementation(async (k: string) => ({ amazon_orders_import: 'false', amazon_stock_push: 'true', amazon_stock_buffer: '2' })[k] ?? null)
  m.write.mockResolvedValue(undefined)
})

describe('amazon orders-settings route', () => {
  it('needs amazon_orders:write and the plan, saving nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(deny(403))
    expect((await put({ importOrders: true, pushStock: true, buffer: 1 })).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon_orders:write')
    m.requireAdminScope.mockResolvedValue(deny(401))
    expect((await put({ importOrders: true, pushStock: true, buffer: 1 })).status).toBe(401)
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await put({ importOrders: true, pushStock: true, buffer: 1 })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Amazon orders needs the Pro plan.')
    expect(m.write).not.toHaveBeenCalled()
  })

  it('rejects invalid settings with 400', async () => {
    for (const body of [{}, { importOrders: 'yes', pushStock: true, buffer: 1 }, { importOrders: true, pushStock: true, buffer: -1 }, { importOrders: true, pushStock: true, buffer: 1.5 }, { importOrders: true, pushStock: true, buffer: 5000 }]) {
      expect((await put(body)).status).toBe(400)
    }
    expect(m.write).not.toHaveBeenCalled()
  })

  it('saves the switches and buffer, and logs before and after', async () => {
    const res = await put({ importOrders: true, pushStock: false, buffer: 5 })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      summary: 'Amazon order import on, stock push off, buffer 5',
      before: { importOrders: false, pushStock: true, buffer: 2 },
      after: { importOrders: true, pushStock: false, buffer: 5 },
    })
    expect(m.write).toHaveBeenCalledWith({ amazon_orders_import: 'true', amazon_stock_push: 'false', amazon_stock_buffer: '5' })
    expect(m.sql.some(s => s.includes('INSERT INTO channel_change_log'))).toBe(true)
  })

  it('answers 400 with the reason when the settings cannot be saved', async () => {
    m.write.mockRejectedValue(new Error('settings table locked'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await put({ importOrders: true, pushStock: true, buffer: 0 })
    expect(res.status).toBe(400)
    expect((await res.json()).problems.join(' ')).toContain('settings table locked')
  })
})

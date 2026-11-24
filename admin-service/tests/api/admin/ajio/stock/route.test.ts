import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ requireAdminScope: vi.fn(), planGate: vi.fn(), stockGet: vi.fn(), stockPush: vi.fn(), stockSettingsPut: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/marketplace/catalog-routes', () => ({ stockGet: m.stockGet, stockPush: m.stockPush, stockSettingsPut: m.stockSettingsPut }))

import * as route from '@admin/app/api/(admin)/admin/ajio/stock/route'

const C = 'ajio'
const ID = '0b5f1a3e-6a4c-4b7e-9d1a-2f0c8e7b6a51'
const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['ajio:read', 'ajio:write', 'ajio_orders:write'] }
const mk = (method: string, qs = '') => new NextRequest(`https://acme.jeffistores.in/api/admin/ajio/stock${qs}`, { method, ...(method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }) })
const ctx = { params: Promise.resolve({ id: ID }) }
const deny = (status: number) => NextResponse.json({ error: 'nope' }, { status })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.stockGet.mockResolvedValue(NextResponse.json({ ok: true }))
  m.stockPush.mockResolvedValue(NextResponse.json({ ok: true }))
  m.stockSettingsPut.mockResolvedValue(NextResponse.json({ ok: true }))
})

describe('ajio stock route', () => {
  describe('GET', () => {
    const r = () => mk('GET', '')
    const run = (req: NextRequest) => route.GET(req)
    it('needs the ajio:read scope and calls nothing without it', async () => {
      m.requireAdminScope.mockResolvedValue(deny(403))
      const res = await run(r())
      expect(res.status).toBe(403)
      expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ajio:read')
      expect(m.stockGet).not.toHaveBeenCalled()
      m.requireAdminScope.mockResolvedValue(deny(401))
      expect((await run(r())).status).toBe(401)
    })
    it('refuses a plan without AJIO and calls nothing', async () => {
      m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
      const res = await run(r())
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'AJIO needs the Pro plan.', upgradeRequired: 'pro' })
      expect(m.planGate).toHaveBeenCalledWith('ajio:read')
      expect(m.stockGet).not.toHaveBeenCalled()
    })
    it('hands the ajio request to stockGet and returns its answer', async () => {
      m.stockGet.mockResolvedValue(NextResponse.json({ done: 3 }, { status: 200 }))
      const req = r()
      const res = await run(req)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ done: 3 })
      expect(m.stockGet).toHaveBeenCalledTimes(1)
      expect(m.stockGet).toHaveBeenCalledWith(C)
    })
    it('passes a 400 and a marketplace failure through unchanged', async () => {
      m.stockGet.mockResolvedValueOnce(NextResponse.json({ error: 'Pick the units.' }, { status: 400 }))
      const bad = await run(r())
      expect(bad.status).toBe(400)
      expect((await bad.json()).error).toBe('Pick the units.')
      m.stockGet.mockResolvedValueOnce(NextResponse.json({ error: 'Upstream down' }, { status: 502 }))
      const down = await run(r())
      expect(down.status).toBe(502)
      expect((await down.json()).error).toBe('Upstream down')
    })
  })
  describe('POST', () => {
    const r = () => mk('POST', '')
    const run = (req: NextRequest) => route.POST(req)
    it('needs the ajio:write scope and calls nothing without it', async () => {
      m.requireAdminScope.mockResolvedValue(deny(403))
      const res = await run(r())
      expect(res.status).toBe(403)
      expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ajio:write')
      expect(m.stockPush).not.toHaveBeenCalled()
      m.requireAdminScope.mockResolvedValue(deny(401))
      expect((await run(r())).status).toBe(401)
    })
    it('refuses a plan without AJIO and calls nothing', async () => {
      m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
      const res = await run(r())
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'AJIO needs the Pro plan.', upgradeRequired: 'pro' })
      expect(m.planGate).toHaveBeenCalledWith('ajio:write')
      expect(m.stockPush).not.toHaveBeenCalled()
    })
    it('hands the ajio request to stockPush and returns its answer', async () => {
      m.stockPush.mockResolvedValue(NextResponse.json({ done: 3 }, { status: 200 }))
      const req = r()
      const res = await run(req)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ done: 3 })
      expect(m.stockPush).toHaveBeenCalledTimes(1)
      expect(m.stockPush).toHaveBeenCalledWith(C, ADMIN)
    })
    it('passes a 400 and a marketplace failure through unchanged', async () => {
      m.stockPush.mockResolvedValueOnce(NextResponse.json({ error: 'Pick the units.' }, { status: 400 }))
      const bad = await run(r())
      expect(bad.status).toBe(400)
      expect((await bad.json()).error).toBe('Pick the units.')
      m.stockPush.mockResolvedValueOnce(NextResponse.json({ error: 'Upstream down' }, { status: 502 }))
      const down = await run(r())
      expect(down.status).toBe(502)
      expect((await down.json()).error).toBe('Upstream down')
    })
  })
  describe('PUT', () => {
    const r = () => mk('PUT', '')
    const run = (req: NextRequest) => route.PUT(req)
    it('needs the ajio:write scope and calls nothing without it', async () => {
      m.requireAdminScope.mockResolvedValue(deny(403))
      const res = await run(r())
      expect(res.status).toBe(403)
      expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ajio:write')
      expect(m.stockSettingsPut).not.toHaveBeenCalled()
      m.requireAdminScope.mockResolvedValue(deny(401))
      expect((await run(r())).status).toBe(401)
    })
    it('refuses a plan without AJIO and calls nothing', async () => {
      m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
      const res = await run(r())
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'AJIO needs the Pro plan.', upgradeRequired: 'pro' })
      expect(m.planGate).toHaveBeenCalledWith('ajio:write')
      expect(m.stockSettingsPut).not.toHaveBeenCalled()
    })
    it('hands the ajio request to stockSettingsPut and returns its answer', async () => {
      m.stockSettingsPut.mockResolvedValue(NextResponse.json({ done: 3 }, { status: 200 }))
      const req = r()
      const res = await run(req)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ done: 3 })
      expect(m.stockSettingsPut).toHaveBeenCalledTimes(1)
      expect(m.stockSettingsPut.mock.calls[0][0]).toBe(req)
      expect(m.stockSettingsPut.mock.calls[0].slice(1)).toEqual([C, ADMIN])
    })
    it('passes a 400 and a marketplace failure through unchanged', async () => {
      m.stockSettingsPut.mockResolvedValueOnce(NextResponse.json({ error: 'Pick the units.' }, { status: 400 }))
      const bad = await run(r())
      expect(bad.status).toBe(400)
      expect((await bad.json()).error).toBe('Pick the units.')
      m.stockSettingsPut.mockResolvedValueOnce(NextResponse.json({ error: 'Upstream down' }, { status: 502 }))
      const down = await run(r())
      expect(down.status).toBe(502)
      expect((await down.json()).error).toBe('Upstream down')
    })
  })
})

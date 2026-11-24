import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ requireAdminScope: vi.fn(), planGate: vi.fn(), imagesPack: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/marketplace/catalog-routes', () => ({ imagesPack: m.imagesPack }))

import * as route from '@admin/app/api/(admin)/admin/myntra/listings/images/route'

const C = 'myntra'
const ID = '0b5f1a3e-6a4c-4b7e-9d1a-2f0c8e7b6a51'
const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['myntra:read', 'myntra:write', 'myntra_orders:write'] }
const mk = (method: string, qs = '') => new NextRequest(`https://acme.jeffistores.in/api/admin/myntra/listings/images${qs}`, { method, ...(method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }) })
const ctx = { params: Promise.resolve({ id: ID }) }
const deny = (status: number) => NextResponse.json({ error: 'nope' }, { status })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.imagesPack.mockResolvedValue(NextResponse.json({ ok: true }))
})

describe('myntra listings/images route', () => {
  describe('POST', () => {
    const r = () => mk('POST', '')
    const run = (req: NextRequest) => route.POST(req)
    it('needs the myntra:write scope and calls nothing without it', async () => {
      m.requireAdminScope.mockResolvedValue(deny(403))
      const res = await run(r())
      expect(res.status).toBe(403)
      expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'myntra:write')
      expect(m.imagesPack).not.toHaveBeenCalled()
      m.requireAdminScope.mockResolvedValue(deny(401))
      expect((await run(r())).status).toBe(401)
    })
    it('refuses a plan without Myntra and calls nothing', async () => {
      m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
      const res = await run(r())
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Myntra needs the Pro plan.', upgradeRequired: 'pro' })
      expect(m.planGate).toHaveBeenCalledWith('myntra:write')
      expect(m.imagesPack).not.toHaveBeenCalled()
    })
    it('hands the myntra request to imagesPack and returns its answer', async () => {
      m.imagesPack.mockResolvedValue(NextResponse.json({ done: 3 }, { status: 200 }))
      const req = r()
      const res = await run(req)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ done: 3 })
      expect(m.imagesPack).toHaveBeenCalledTimes(1)
      expect(m.imagesPack.mock.calls[0][0]).toBe(req)
      expect(m.imagesPack.mock.calls[0].slice(1)).toEqual([C, ADMIN])
    })
    it('passes a 400 and a marketplace failure through unchanged', async () => {
      m.imagesPack.mockResolvedValueOnce(NextResponse.json({ error: 'Pick the units.' }, { status: 400 }))
      const bad = await run(r())
      expect(bad.status).toBe(400)
      expect((await bad.json()).error).toBe('Pick the units.')
      m.imagesPack.mockResolvedValueOnce(NextResponse.json({ error: 'Upstream down' }, { status: 502 }))
      const down = await run(r())
      expect(down.status).toBe(502)
      expect((await down.json()).error).toBe('Upstream down')
    })
  })
})

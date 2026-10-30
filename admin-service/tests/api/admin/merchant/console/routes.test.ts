import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ requireAdminScope: vi.fn(), planGate: vi.fn(), run: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/merchant/actions', async () => {
  const actual = await vi.importActual<any>('@/lib/merchant/actions')
  return { ...actual, runMerchantAction: m.run }
})
vi.mock('@/lib/merchant/console-data', async () => {
  const actual = await vi.importActual<any>('@/lib/merchant/console-data')
  return { ...actual, loadMerchantTab: m.load }
})

import { POST as action } from '@admin/app/api/(admin)/admin/merchant/console/actions/route'
import { GET as consoleGet } from '@admin/app/api/(admin)/admin/merchant/console/route'

const ADMIN = { adminId: 'a1', email: 'o@s.in', role: 'staff', scopes: ['merchant_sync:write'] }
const post = (body: unknown) => new NextRequest('https://acme.jeffistores.in/api/admin/merchant/console/actions', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.run.mockResolvedValue({ ok: true, preview: true, summary: 's', problems: [] })
  m.load.mockResolvedValue({ ok: 1 })
})

describe('merchant console actions', () => {
  it('requires merchant_sync:write and the plan', async () => {
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await action(post({ action: 'product.repush', productId: '4dc8105c-97b9-460a-844a-6057319b0334' }))
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'merchant_sync:write')
    expect(res.status).toBe(403)
    expect(m.run).not.toHaveBeenCalled()
  })
  it('needs the settings permission for account-wide changes', async () => {
    const res = await action(post({ action: 'returns.delete', name: 'accounts/1/onlineReturnPolicies/abc' }))
    expect(res.status).toBe(403)
    m.requireAdminScope.mockResolvedValue({ ...ADMIN, scopes: ['merchant_sync:write', 'merchant_sync:settings_write'] })
    expect((await action(post({ action: 'returns.delete', name: 'accounts/1/onlineReturnPolicies/abc' }))).status).toBe(200)
  })
  it('passes preview through and rejects bad bodies', async () => {
    await action(post({ action: 'product.price', offerId: 'SKU1', price: 99, preview: true }))
    expect(m.run).toHaveBeenCalledWith({ action: 'product.price', offerId: 'SKU1', price: 99 }, { adminId: 'a1', email: 'o@s.in' }, true)
    expect((await action(post({ action: 'nope' }))).status).toBe(400)
  })
  it('passes through a failed scope check', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await action(post({ action: 'product.repush', productId: '4dc8105c-97b9-460a-844a-6057319b0334' }))).status).toBe(403)
  })
})

describe('merchant console data', () => {
  it('validates tab and range', async () => {
    const get = (qs: string) => consoleGet(new NextRequest(`https://x/api/admin/merchant/console?${qs}`))
    expect((await get('tab=nope&from=2026-10-01&to=2026-10-02')).status).toBe(400)
    expect((await get('tab=overview&from=2026-10-05&to=2026-10-01')).status).toBe(400)
    const ok = await get('tab=insights&from=2026-10-01&to=2026-10-02')
    expect(ok.status).toBe(200)
    expect(m.load).toHaveBeenCalledWith('insights', { from: '2026-10-01', to: '2026-10-02' })
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'merchant_sync:read')
  })
})

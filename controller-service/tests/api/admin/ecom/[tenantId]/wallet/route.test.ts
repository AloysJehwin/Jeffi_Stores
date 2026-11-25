import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const audit = vi.hoisted(() => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => audit)
const wallet = vi.hoisted(() => ({ getTenantWallet: vi.fn(), rechargeWallet: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => wallet)

import { GET as rawGET, POST as rawPOST } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/wallet/route'

// the route's gate union types its early return as possibly undefined; it is always a response
type Ctx = { params: Promise<{ tenantId: string }> }
const GET = rawGET as (r: NextRequest, c: Ctx) => Promise<Response>
const POST = rawPOST as (r: NextRequest, c: Ctx) => Promise<Response>

const ctx = { params: Promise.resolve({ tenantId: 't-1' }) }
const get = () => GET(new NextRequest('http://localhost/api/admin/ecom/t-1/wallet'), ctx)
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/t-1/wallet', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), ctx)

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme' })
  wallet.getTenantWallet.mockResolvedValue({ balance: 10, ledger: [] })
  wallet.rechargeWallet.mockResolvedValue({ ok: true, balance: 60 })
  audit.logAdminAudit.mockResolvedValue(undefined)
})

describe('GET /api/admin/ecom/[tenantId]/wallet', () => {
  it('401s / 403s / 404s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await get()).status).toBe(403)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
    reg.getTenant.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
  })

  it('returns the wallet with its last 200 ledger rows', async () => {
    expect(await (await get()).json()).toEqual({ balance: 10, ledger: [] })
    expect(wallet.getTenantWallet).toHaveBeenCalledWith('t-1', 200)
  })
})

describe('POST /api/admin/ecom/[tenantId]/wallet', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await post({ amountInr: 50, note: 'x' })).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await post({ amountInr: 50, note: 'x' })).status).toBe(403)
    expect(wallet.rechargeWallet).not.toHaveBeenCalled()
  })

  it.each([[{ amountInr: 0, note: 'x' }], [{ amountInr: 2_000_000, note: 'x' }], [{ amountInr: 5, note: '  ' }], [{ amountInr: 5 }], ['not json']])(
    '400s for a bad credit %#',
    async body => {
      expect((await post(body)).status).toBe(400)
      expect(wallet.rechargeWallet).not.toHaveBeenCalled()
    }
  )

  it('credits the wallet and writes an audit row', async () => {
    const res = await post({ amountInr: 50, note: 'goodwill' })
    expect(await res.json()).toEqual({ success: true, balance: 60 })
    expect(wallet.rechargeWallet).toHaveBeenCalledWith({ tenantId: 't-1', amountInr: 50, note: 'Platform credit — goodwill' })
    expect(audit.logAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: 'a-1', entityId: 't-1', metadata: expect.objectContaining({ amountInr: 50, source: 'platform-admin' }) })
    )
  })

  it('still succeeds when the audit write fails', async () => {
    audit.logAdminAudit.mockRejectedValue(new Error('db'))
    expect((await post({ amountInr: 50, note: 'x' })).status).toBe(200)
  })

  it('500s when the recharge fails, writing no audit row', async () => {
    wallet.rechargeWallet.mockResolvedValue({ ok: false, error: 'ledger locked' })
    const res = await post({ amountInr: 50, note: 'x' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'ledger locked' })
    expect(audit.logAdminAudit).not.toHaveBeenCalled()
  })
})

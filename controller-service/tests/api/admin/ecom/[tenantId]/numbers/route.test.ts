import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const senders = vi.hoisted(() => ({ PLATFORM_TENANT_ID: 'platform', audiencesFor: vi.fn(), listTenantSenders: vi.fn() }))
vi.mock('@/lib/messaging/tenant-senders', () => senders)
const addon = vi.hoisted(() => ({ invalidateMessagingEntitlement: vi.fn(), messagingEntitlement: vi.fn() }))
vi.mock('@/lib/billing/messaging-addon', () => addon)
const nums = vi.hoisted(() => ({ provisionTenantNumber: vi.fn(), refreshTenantNumbers: vi.fn(), releaseTenantNumber: vi.fn(), retryWhatsApp: vi.fn() }))
vi.mock('@controller/lib/messaging/tenant-numbers', () => nums)

import { GET, POST, PATCH, DELETE } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/numbers/route'

const ctx = (tenantId = 't-1') => ({ params: Promise.resolve({ tenantId }) })
const u = (qs = '') => `http://localhost/api/admin/ecom/t-1/numbers${qs}`
const send = (fn: typeof POST, method: string, body: unknown, tenantId?: string) => fn(new NextRequest(u(), { method, body: JSON.stringify(body) }), ctx(tenantId))
const good = { audience: 'customer', number: '+14155550123', displayName: 'Acme Store' }

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme' })
  senders.audiencesFor.mockReturnValue(['customer', 'admin'])
  senders.listTenantSenders.mockResolvedValue([{ sender: '+1' }])
  addon.messagingEntitlement.mockResolvedValue({ sms: { allowed: true } })
  nums.provisionTenantNumber.mockResolvedValue({ status: 'pending' })
})

describe('/api/admin/ecom/[tenantId]/numbers', () => {
  it('401s, 403s and 404s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await GET(new NextRequest(u()), ctx())).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await GET(new NextRequest(u()), ctx())).status).toBe(403)
    expect(nums.refreshTenantNumbers).not.toHaveBeenCalled()
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
    reg.getTenant.mockResolvedValue(null)
    expect((await GET(new NextRequest(u()), ctx())).status).toBe(404)
  })

  it('GET refreshes WhatsApp status then returns senders and entitlement', async () => {
    const res = await GET(new NextRequest(u()), ctx())
    expect(await res.json()).toEqual({ senders: [{ sender: '+1' }], entitlement: { sms: { allowed: true } } })
    expect(nums.refreshTenantNumbers).toHaveBeenCalledWith('t-1')
    expect(addon.messagingEntitlement).toHaveBeenCalledWith('t-1', { maxAgeMs: 0 })
  })

  it('GET on the flagship skips the add-on', async () => {
    const res = await GET(new NextRequest(u()), ctx('platform'))
    expect(await res.json()).toEqual({ senders: [{ sender: '+1' }] })
    expect(reg.getTenant).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ ...good, number: '4155550123' }], [{ ...good, displayName: 'ab' }], [{ ...good, audience: 'x' }]])('POST 400s for a bad body %#', async body => {
    expect((await send(POST, 'POST', body)).status).toBe(400)
    expect(nums.provisionTenantNumber).not.toHaveBeenCalled()
  })

  it('POST 400s for an audience the store lacks and for a bought flagship customer number', async () => {
    senders.audiencesFor.mockReturnValue(['customer'])
    expect((await send(POST, 'POST', { ...good, audience: 'admin' })).status).toBe(400)
    senders.audiencesFor.mockReturnValue(['customer', 'admin'])
    const res = await send(POST, 'POST', good, 'platform')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('assigned in Settings')
  })

  it('POST buys the number for the audience', async () => {
    const res = await send(POST, 'POST', good)
    expect(res.status).toBe(200)
    expect((await res.json()).result).toEqual({ status: 'pending' })
    expect(nums.provisionTenantNumber).toHaveBeenCalledWith({
      tenantId: 't-1', audience: 'customer', number: '+14155550123', displayName: 'Acme Store', storeSlug: 'acme', createdBy: 'a-1',
    })
  })

  it('POST relays a purchase failure as 400', async () => {
    nums.provisionTenantNumber.mockRejectedValue(new Error('sold out'))
    const res = await send(POST, 'POST', good)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'sold out' })
  })

  it('PATCH retries WhatsApp registration', async () => {
    const res = await send(PATCH, 'PATCH', { audience: 'customer', displayName: 'Acme Store' })
    expect(res.status).toBe(200)
    expect(nums.retryWhatsApp).toHaveBeenCalledWith('t-1', 'customer', 'Acme Store')
    nums.retryWhatsApp.mockRejectedValue(new Error('rejected'))
    expect((await send(PATCH, 'PATCH', { audience: 'customer', displayName: 'Acme Store' })).status).toBe(400)
    expect((await send(PATCH, 'PATCH', { audience: 'customer' })).status).toBe(400)
  })

  it('DELETE releases the number', async () => {
    expect((await DELETE(new NextRequest(u('?audience=nope'), { method: 'DELETE' }), ctx())).status).toBe(400)
    const res = await DELETE(new NextRequest(u('?audience=customer'), { method: 'DELETE' }), ctx())
    expect(res.status).toBe(200)
    expect(nums.releaseTenantNumber).toHaveBeenCalledWith('t-1', 'customer')
    nums.releaseTenantNumber.mockRejectedValue(new Error('in use'))
    expect((await DELETE(new NextRequest(u('?audience=customer'), { method: 'DELETE' }), ctx())).status).toBe(400)
  })
})

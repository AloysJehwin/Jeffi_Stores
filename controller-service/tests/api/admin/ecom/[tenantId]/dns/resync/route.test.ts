import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const trigger = vi.hoisted(() => ({ triggerProvisioning: vi.fn() }))
vi.mock('@controller/lib/provisioning/trigger', () => trigger)

import { POST } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/dns/resync/route'

const call = () => POST(new NextRequest('http://localhost/api/admin/ecom/t-1/dns/resync', { method: 'POST' }), { params: Promise.resolve({ tenantId: 't-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', plan: 'growth', status: 'active' })
  trigger.triggerProvisioning.mockResolvedValue({ ok: true, added: ['forms-acme'], removed: [] })
})

describe('POST /api/admin/ecom/[tenantId]/dns/resync', () => {
  it('401s when unauthenticated', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('403s for a non-administrator', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call()).status).toBe(403)
    expect(trigger.triggerProvisioning).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('409s for a tenant that is not active', async () => {
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', status: 'suspended' })
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('suspended')
    expect(trigger.triggerProvisioning).not.toHaveBeenCalled()
  })

  it('re-provisions DNS and reports the host changes', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ success: true, added: ['forms-acme'], removed: [] })
    expect(trigger.triggerProvisioning).toHaveBeenCalledWith({
      action: 'reprovision',
      tenantId: 't-1',
      slug: 'acme',
      plan: 'growth',
      ownerId: null,
      reason: 'operator',
    })
  })

  it('500s with the trigger error', async () => {
    trigger.triggerProvisioning.mockResolvedValue({ ok: false, error: 'cloudflare down' })
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'cloudflare down' })
  })
})

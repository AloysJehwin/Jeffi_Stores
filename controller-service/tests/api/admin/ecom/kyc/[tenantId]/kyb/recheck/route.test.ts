import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const next = vi.hoisted(() => ({ after: vi.fn() }))
vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after: next.after }))
const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const kyb = vi.hoisted(() => ({ queueRecheck: vi.fn() }))
vi.mock('@controller/lib/kyb/analyze', () => kyb)

import { POST } from '@controller/app/api/(admin)/admin/ecom/kyc/[tenantId]/kyb/recheck/route'

const call = () => POST(new NextRequest('http://localhost/api/admin/ecom/kyc/t-1/kyb/recheck', { method: 'POST' }), { params: Promise.resolve({ tenantId: 't-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1' })
  kyb.queueRecheck.mockResolvedValue({ count: 2, run: vi.fn() })
})

describe('POST /api/admin/ecom/kyc/[tenantId]/kyb/recheck', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call()).status).toBe(403)
    expect(kyb.queueRecheck).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    reg.getTenant.mockRejectedValue(new Error('db'))
    expect((await call()).status).toBe(404)
  })

  it('queues every non-approved document and runs the read after the response', async () => {
    const run = vi.fn()
    kyb.queueRecheck.mockResolvedValue({ count: 2, run })
    const res = await call()
    expect(await res.json()).toEqual({ ok: true, count: 2 })
    expect(kyb.queueRecheck).toHaveBeenCalledWith('t-1', { all: true, licences: true })
    expect(next.after).toHaveBeenCalledWith(run)
  })

  it('schedules nothing when no document needs a check', async () => {
    kyb.queueRecheck.mockResolvedValue({ count: 0, run: vi.fn() })
    expect((await (await call()).json()).count).toBe(0)
    expect(next.after).not.toHaveBeenCalled()
  })
})

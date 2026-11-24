import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const change = vi.hoisted(() => ({ checkComputeChange: vi.fn() }))
vi.mock('@controller/lib/compute/change', () => change)
vi.mock('@controller/lib/compute/schema', () => ({ ComputeSpecSchema: z.object({ preset: z.string() }) }))
const store = vi.hoisted(() => ({ getTenantCompute: vi.fn(), patchTenantCompute: vi.fn(), saveDesiredCompute: vi.fn() }))
vi.mock('@controller/lib/compute/store', () => store)

import { GET, PUT } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/compute/route'

const ctx = { params: Promise.resolve({ tenantId: 't-1' }) }
const get = () => GET(new NextRequest('http://localhost/api/admin/ecom/t-1/compute'), ctx)
const put = (body: unknown) =>
  PUT(new NextRequest('http://localhost/api/admin/ecom/t-1/compute', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }), ctx)

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  store.getTenantCompute.mockResolvedValue({ status: 'failed' })
  change.checkComputeChange.mockResolvedValue({ status: 200, quote: { inr: 100 } })
})

describe('GET /api/admin/ecom/[tenantId]/compute', () => {
  it('401s / 403s without a platform administrator', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await get()).status).toBe(403)
    expect(store.getTenantCompute).not.toHaveBeenCalled()
  })

  it('returns the compute row', async () => {
    expect(await (await get()).json()).toEqual({ compute: { status: 'failed' } })
    expect(store.getTenantCompute).toHaveBeenCalledWith('t-1')
  })
})

describe('PUT /api/admin/ecom/[tenantId]/compute', () => {
  it('401s when unauthenticated', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await put({ action: 'retry' })).status).toBe(401)
  })

  it('403s for a non-administrator', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: ['ecom_customers:write'] })
    expect((await put({ action: 'retry' })).status).toBe(403)
    expect(store.patchTenantCompute).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ spec: { preset: 3 } }], ['not json']])('400s for a bad body %#', async body => {
    expect((await put(body)).status).toBe(400)
  })

  it('409s a retry when no change has failed', async () => {
    store.getTenantCompute.mockResolvedValue({ status: 'applied' })
    expect((await put({ action: 'retry' })).status).toBe(409)
    expect(store.patchTenantCompute).not.toHaveBeenCalled()
  })

  it('resets a failed change so the worker retries it', async () => {
    const res = await put({ action: 'retry' })
    expect(await res.json()).toEqual({ ok: true })
    expect(store.patchTenantCompute).toHaveBeenCalledWith('t-1', { status: 'applying', attempts: 0, next_at: null, last_error: null })
  })

  it('relays a refused change', async () => {
    change.checkComputeChange.mockResolvedValue({ status: 422, error: 'too big', quote: null })
    const res = await put({ spec: { preset: 'xl' } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'too big', quote: null })
    expect(store.saveDesiredCompute).not.toHaveBeenCalled()
  })

  it('saves the override with the window default and the admin bypass', async () => {
    const res = await put({ spec: { preset: 'xl' } })
    expect(await res.json()).toEqual({ ok: true, quote: { inr: 100 } })
    expect(change.checkComputeChange).toHaveBeenCalledWith('t-1', { preset: 'xl' }, { admin: true })
    expect(store.saveDesiredCompute).toHaveBeenCalledWith('t-1', { preset: 'xl' }, 'window')
  })

  it('honours applyMode now', async () => {
    await put({ spec: { preset: 'xl' }, applyMode: 'now' })
    expect(store.saveDesiredCompute).toHaveBeenCalledWith('t-1', { preset: 'xl' }, 'now')
  })
})

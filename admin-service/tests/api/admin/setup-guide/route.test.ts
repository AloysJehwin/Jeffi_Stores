import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const progress = vi.hoisted(() => ({ setStoreProgress: vi.fn(), setPlatformProgress: vi.fn() }))
const resolveTenantId = vi.hoisted(() => vi.fn())
const getPlatformApps = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ withPlan: async (a: unknown) => a, readJson: (r: Request) => r.json().catch(() => null) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/setup-guide/progress', () => ({ MANUAL_STATES: ['applied', 'approved', 'skipped'], ...progress }))
vi.mock('@/lib/setup-guide/status', () => ({ getPlatformApps }))

import { PATCH } from '@admin/app/api/(admin)/admin/setup-guide/[stepId]/route'
import { GET as platformGET, PATCH as platformPATCH } from '@admin/app/api/(admin)/admin/setup-guide/platform/route'
import { requireAdminScope } from '@/lib/auth/jwt'

const T = '33333333-3333-3333-3333-333333333333'
const patch = (url: string, body: unknown) => new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body) })
const step = (id: string, body: unknown) => PATCH(patch(`http://localhost/api/admin/setup-guide/${id}`, body), { params: Promise.resolve({ stepId: id }) })
const platformUrl = 'http://localhost/api/admin/setup-guide/platform'
const as = (role: string) => vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', email: 'owner@crm.test', role, scopes: [] } as any)

describe('PATCH /api/admin/setup-guide/[stepId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    as('super_admin')
    progress.setStoreProgress.mockResolvedValue(undefined)
  })

  it('needs setup_guide:write', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await step('google-ads', { state: 'applied' })).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'setup_guide:write')
    expect(progress.setStoreProgress).not.toHaveBeenCalled()
  })

  it('rejects an unknown step and an invalid body', async () => {
    expect((await step('no-such-step', { state: 'applied' })).status).toBe(404)
    expect((await step('google-ads', { state: 'done' })).status).toBe(400)
    expect((await step('google-ads', { state: 'applied', appliedAt: '07/11/2026' })).status).toBe(400)
    expect((await step('google-ads', { state: 'applied', appliedAt: '2999-01-01' })).status).toBe(400)
    expect((await step('google-ads', { state: 'skipped', note: 'x'.repeat(501) })).status).toBe(400)
    expect(progress.setStoreProgress).not.toHaveBeenCalled()
  })

  it('saves the state, keeping the applied date only for applied', async () => {
    expect((await step('google-ads', { state: 'applied', appliedAt: '2026-11-01', note: 'Basic access form sent' })).status).toBe(200)
    expect(progress.setStoreProgress).toHaveBeenLastCalledWith('google-ads', { state: 'applied', appliedAt: '2026-11-01', note: 'Basic access form sent' }, 'owner@crm.test')
    await step('pinterest', { state: 'approved', appliedAt: '2026-11-01' })
    expect(progress.setStoreProgress).toHaveBeenLastCalledWith('pinterest', { state: 'approved', appliedAt: null, note: null }, 'owner@crm.test')
    await step('pinterest', { state: null })
    expect(progress.setStoreProgress).toHaveBeenLastCalledWith('pinterest', { state: null, appliedAt: null, note: null }, 'owner@crm.test')
  })
})

describe('/api/admin/setup-guide/platform', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    as('administrator')
    resolveTenantId.mockResolvedValue(null)
    getPlatformApps.mockResolvedValue({ items: [], counts: {} })
    progress.setPlatformProgress.mockResolvedValue(undefined)
  })

  it('refuses anyone but the administrator', async () => {
    as('super_admin')
    expect((await platformGET(new NextRequest(platformUrl))).status).toBe(403)
    expect((await platformPATCH(patch(platformUrl, { itemId: 'meta-app', state: 'applied' }))).status).toBe(403)
    expect(getPlatformApps).not.toHaveBeenCalled()
    expect(progress.setPlatformProgress).not.toHaveBeenCalled()
  })

  it('refuses a store host even for the administrator', async () => {
    resolveTenantId.mockResolvedValue(T)
    expect((await platformGET(new NextRequest(platformUrl))).status).toBe(403)
    expect((await platformPATCH(patch(platformUrl, { itemId: 'meta-app', state: 'applied' }))).status).toBe(403)
  })

  it('lists and saves for the administrator on the flagship', async () => {
    expect((await platformGET(new NextRequest(platformUrl))).status).toBe(200)
    expect((await platformPATCH(patch(platformUrl, { itemId: 'nope', state: 'applied' }))).status).toBe(404)
    expect((await platformPATCH(patch(platformUrl, { itemId: 'meta-app', state: 'approved' }))).status).toBe(200)
    expect(progress.setPlatformProgress).toHaveBeenCalledWith('meta-app', { state: 'approved', appliedAt: null, note: null }, 'owner@crm.test')
  })
})

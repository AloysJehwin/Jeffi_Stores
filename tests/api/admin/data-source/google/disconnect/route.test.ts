import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/import/jobs', () => ({
  PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000',
  resolveImportTenantId: vi.fn(),
  isSheetSyncRunning: vi.fn(),
  cancelPendingSheetSyncs: vi.fn(),
}))
vi.mock('@/lib/import/sheet-links', () => ({ forgetSheetOwnership: vi.fn(), releaseSheetProducts: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ deleteIntegrationCredential: vi.fn(), lookupTenantContextById: vi.fn() }))
vi.mock('@/lib/tenant-context', () => ({ runWithTenantContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()) }))

import { POST } from '@/app/api/admin/data-source/google/disconnect/route'
import { requireAdminScope } from '@/lib/jwt'
import { logAdminAudit } from '@/lib/admin-audit'
import { resolveImportTenantId, isSheetSyncRunning, cancelPendingSheetSyncs } from '@/lib/import/jobs'
import { forgetSheetOwnership, releaseSheetProducts } from '@/lib/import/sheet-links'
import { deleteIntegrationCredential, lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenant-context'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const req = () => new NextRequest('http://localhost/api/admin/data-source/google/disconnect', { method: 'POST' })

function expectNothingChanged() {
  expect(cancelPendingSheetSyncs).not.toHaveBeenCalled()
  expect(forgetSheetOwnership).not.toHaveBeenCalled()
  expect(releaseSheetProducts).not.toHaveBeenCalled()
  expect(deleteIntegrationCredential).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: ['products:write'] } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue(PLATFORM)
  vi.mocked(isSheetSyncRunning).mockResolvedValue(false)
  vi.mocked(cancelPendingSheetSyncs).mockResolvedValue(1)
  vi.mocked(forgetSheetOwnership).mockResolvedValue(3)
  vi.mocked(releaseSheetProducts).mockResolvedValue(7)
})

describe('POST /api/admin/data-source/google/disconnect', () => {
  it('returns the auth refusal untouched', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await POST(req())).status).toBe(403)
    expectNothingChanged()
  })

  it('409s while a sync is running and changes nothing', async () => {
    vi.mocked(isSheetSyncRunning).mockResolvedValue(true)
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/sync is running/)
    expectNothingChanged()
  })

  it('stops queued syncs, forgets sheet ownership and re-tags products before removing the credential', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, released: 7 })
    expect(cancelPendingSheetSyncs).toHaveBeenCalledWith(PLATFORM, expect.any(String))
    expect(forgetSheetOwnership).toHaveBeenCalledWith(PLATFORM)
    expect(deleteIntegrationCredential).toHaveBeenCalledWith(PLATFORM, 'google_sheets')
    const deletedAt = vi.mocked(deleteIntegrationCredential).mock.invocationCallOrder[0]
    expect(vi.mocked(forgetSheetOwnership).mock.invocationCallOrder[0]).toBeLessThan(deletedAt)
    expect(vi.mocked(releaseSheetProducts).mock.invocationCallOrder[0]).toBeLessThan(deletedAt)
    expect(lookupTenantContextById).not.toHaveBeenCalled()
    expect(runWithTenantContext).not.toHaveBeenCalled()
    expect(vi.mocked(logAdminAudit).mock.calls[0][0]).toMatchObject({
      metadata: { released: 7, unlinked: 3, cancelled: 1 },
    })
  })

  it('re-tags a tenant store inside that tenant context', async () => {
    const ctx = { tenantId: 'tenant-1' } as any
    vi.mocked(resolveImportTenantId).mockResolvedValue('tenant-1')
    vi.mocked(lookupTenantContextById).mockResolvedValue(ctx)
    expect((await POST(req())).status).toBe(200)
    expect(runWithTenantContext).toHaveBeenCalledWith(ctx, releaseSheetProducts)
    expect(deleteIntegrationCredential).toHaveBeenCalledWith('tenant-1', 'google_sheets')
  })

  it('404s for an unresolvable tenant before touching anything', async () => {
    vi.mocked(resolveImportTenantId).mockResolvedValue('tenant-gone')
    vi.mocked(lookupTenantContextById).mockResolvedValue(null)
    expect((await POST(req())).status).toBe(404)
    expectNothingChanged()
  })

  it('keeps the credential when the re-tag fails, so the disconnect can be retried', async () => {
    vi.mocked(releaseSheetProducts).mockRejectedValue(new Error('store db down'))
    await expect(POST(req())).rejects.toThrow('store db down')
    expect(deleteIntegrationCredential).not.toHaveBeenCalled()
  })
})

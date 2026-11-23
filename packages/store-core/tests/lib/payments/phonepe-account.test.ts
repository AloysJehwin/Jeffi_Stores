import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolveRequestTenant = vi.fn()
const isFlagship = vi.fn()
const pinnedTenantSlug = vi.fn<(...a: any[]) => string | null>(() => null)
const resolveUpiMode = vi.fn()

vi.mock('@/lib/shared/db', () => ({ resolveRequestTenant: (...a: any[]) => resolveRequestTenant(...a) }))
vi.mock('@/lib/import/jobs', () => ({ PLATFORM_TENANT_ID: 'PLATFORM' }))
vi.mock('@/lib/tenant-registry', () => ({}))
vi.mock('@/lib/payments/webhook-tenant', () => ({ isFlagship: (...a: any[]) => isFlagship(...a) }))
vi.mock('@/lib/service-routing', () => ({ pinnedTenantSlug: () => pinnedTenantSlug() }))
vi.mock('@/lib/payments/upi/creds', () => ({ resolveUpiMode: (...a: any[]) => resolveUpiMode(...a) }))

import { phonePeAccountFor } from '@/lib/payments/phonepe-account'

beforeEach(() => {
  resolveRequestTenant.mockReset()
  isFlagship.mockReset().mockReturnValue(false)
  pinnedTenantSlug.mockReset().mockReturnValue(null)
  resolveUpiMode.mockReset()
})

describe('phonePeAccountFor', () => {
  it('platform when no tenant resolved', async () => {
    resolveRequestTenant.mockResolvedValue(null)
    expect(await phonePeAccountFor()).toEqual({ kind: 'platform', tenantId: null, credTenantId: 'PLATFORM', slug: null, upiMode: 'auto' })
  })
  it('throws when store pod cannot resolve tenant', async () => {
    resolveRequestTenant.mockResolvedValue(null)
    pinnedTenantSlug.mockReturnValue('myslug')
    await expect(phonePeAccountFor()).rejects.toThrow(/Store myslug/)
  })
  it('platform for flagship tenant', async () => {
    resolveRequestTenant.mockResolvedValue({ tenantId: 'flag' })
    isFlagship.mockReturnValue(true)
    expect(await phonePeAccountFor()).toMatchObject({ kind: 'platform', credTenantId: 'PLATFORM' })
  })
  it('store with resolved upi mode', async () => {
    resolveRequestTenant.mockResolvedValue({ tenantId: 't1', slug: 's1' })
    resolveUpiMode.mockResolvedValue('phonepe')
    const r = await phonePeAccountFor()
    expect(r).toEqual({ kind: 'store', tenantId: 't1', credTenantId: 't1', slug: 's1', upiMode: 'phonepe' })
    expect(resolveUpiMode).toHaveBeenCalledWith('t1')
  })
  it('store slug null when absent', async () => {
    resolveRequestTenant.mockResolvedValue({ tenantId: 't1' })
    resolveUpiMode.mockResolvedValue('auto')
    expect((await phonePeAccountFor()).slug).toBeNull()
  })
})

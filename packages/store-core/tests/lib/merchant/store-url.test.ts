import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockResolveTenant, mockListCustomDomains } = vi.hoisted(() => ({
  mockResolveTenant: vi.fn(),
  mockListCustomDomains: vi.fn(),
}))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: mockResolveTenant }))
vi.mock('@/lib/tenant-registry', () => ({ listCustomDomains: mockListCustomDomains }))

import { storePublicBaseUrl } from '@/lib/merchant/store-url'

const ENV_KEYS = ['NEXT_PUBLIC_BASE_URL', 'APP_URL', 'PLATFORM_DOMAIN'] as const
const saved: Record<string, string | undefined> = {}

describe('storePublicBaseUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    mockListCustomDomains.mockResolvedValue([])
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('flagship uses the configured public site url', async () => {
    mockResolveTenant.mockResolvedValue(null)
    process.env.NEXT_PUBLIC_BASE_URL = 'https://jeffistores.in/'
    process.env.APP_URL = 'https://app.example.com'
    expect(await storePublicBaseUrl()).toBe('https://jeffistores.in')
  })

  it('flagship falls back to APP_URL, then the platform domain (never jeffistoress.com)', async () => {
    mockResolveTenant.mockResolvedValue(null)
    process.env.APP_URL = 'https://app.example.com'
    expect(await storePublicBaseUrl()).toBe('https://app.example.com')
    delete process.env.APP_URL
    expect(await storePublicBaseUrl()).toBe('https://jeffistores.in')
  })

  it('tenant uses its verified custom domain, not the flagship url', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://jeffistores.in'
    mockResolveTenant.mockResolvedValue({ tenantId: 't1', slug: 'acme' })
    mockListCustomDomains.mockResolvedValue([
      { domain: 'pending.acme.com', status: 'pending' },
      { domain: 'shop.acme.com', status: 'verified' },
    ])
    expect(await storePublicBaseUrl()).toBe('https://shop.acme.com')
    expect(mockListCustomDomains).toHaveBeenCalledWith('t1')
  })

  it('tenant without a verified domain uses {slug}.<platform domain>', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://jeffistores.in'
    process.env.PLATFORM_DOMAIN = 'example.net'
    mockResolveTenant.mockResolvedValue({ tenantId: 't1', slug: 'acme' })
    mockListCustomDomains.mockResolvedValue([{ domain: 'shop.acme.com', status: 'pending' }])
    expect(await storePublicBaseUrl()).toBe('https://acme.example.net')
  })

  it('tenant falls back to its subdomain when the domain lookup fails', async () => {
    mockResolveTenant.mockResolvedValue({ tenantId: 't1', slug: 'acme' })
    mockListCustomDomains.mockRejectedValue(new Error('db down'))
    expect(await storePublicBaseUrl()).toBe('https://acme.jeffistores.in')
  })
})

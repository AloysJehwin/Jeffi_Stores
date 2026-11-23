import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// getCurrentTenant is the only static dependency; everything else is lazily imported.
vi.mock('@/lib/tenancy/tenant-context', () => ({
  getCurrentTenant: vi.fn(() => null),
}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ lookupTenantContextBySlug: vi.fn() }))
vi.mock('@/lib/shared/business-path', () => ({ businessBaseUrl: vi.fn(() => 'https://biz.example') }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getStoreIdentity: vi.fn(),
  getStorefrontContent: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import {
  platformBrandName,
  platformAdminEmail,
  tenantNoReplyAddress,
  tenantCampaignAddress,
  currentBrandName,
  currentAdminBaseUrl,
  platformOAuthBaseUrl,
  currentStoreUrl,
  storeBaseUrlAsync,
  businessBaseUrlAsync,
  currentAdminBaseUrlAsync,
  customerMailFrom,
  customerMailFromAsync,
  currentBrandNameAsync,
  campaignMailFromAsync,
  resolveCurrentTenant,
  storeContactLine,
  storeMailTheme,
  storeAddressLine,
  storeOrigin,
  storeDescriptorForPrompt,
  adminMailFrom,
  storeSignature,
} from '@/lib/catalog/brand'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'
import { headers } from 'next/headers'
import { lookupTenantContextBySlug } from '@/lib/tenant-registry'
import { getStoreIdentity, getStorefrontContent } from '@/lib/catalog/site-controls'
import { queryMany } from '@/lib/shared/db'

const ENV = process.env

beforeEach(() => {
  process.env = { ...ENV }
  delete process.env.PLATFORM_BRAND_NAME
  delete process.env.ADMIN_EMAIL
  delete process.env.ADMIN_BASE_URL
  delete process.env.APP_URL
  delete process.env.SES_FROM_EMAIL
  delete process.env.SES_PROMO_FROM_EMAIL
  delete process.env.SES_ADMIN_FROM_EMAIL
  vi.mocked(getCurrentTenant).mockReturnValue(null)
  // Header reader defaults to "no slug".
  vi.mocked(headers).mockResolvedValue({ get: () => null } as any)
})
afterEach(() => {
  process.env = ENV
  vi.clearAllMocks()
})

describe('platform identity (env-driven)', () => {
  it('defaults and env overrides for the brand name', () => {
    expect(platformBrandName()).toBe('Jeffi Stores')
    process.env.PLATFORM_BRAND_NAME = 'Acme'
    expect(platformBrandName()).toBe('Acme')
  })
  it('admin email default + override', () => {
    expect(platformAdminEmail()).toBe('admin@jeffistores.in')
    process.env.ADMIN_EMAIL = 'ops@x.com'
    expect(platformAdminEmail()).toBe('ops@x.com')
  })
  it('tenant sender addresses', () => {
    expect(tenantNoReplyAddress('acme')).toBe('noreply-acme@jeffistores.in')
    expect(tenantCampaignAddress('acme')).toBe('campaigns-acme@jeffistores.in')
  })
})

describe('currentBrandName (sync)', () => {
  it('platform name off-tenant', () => {
    expect(currentBrandName()).toBe('Jeffi Stores')
  })
  it('tenant displayName when present', () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: ' Acme Co ' } as any)
    expect(currentBrandName()).toBe('Acme Co')
  })
  it('"{slug} Store" when a slug but no display name', () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: '  ' } as any)
    expect(currentBrandName()).toBe('acme Store')
  })
})

describe('sync URL helpers', () => {
  it('currentAdminBaseUrl: tenant host vs platform default/override', () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme' } as any)
    expect(currentAdminBaseUrl()).toBe('https://admin-acme.jeffistores.in')
    vi.mocked(getCurrentTenant).mockReturnValue(null)
    expect(currentAdminBaseUrl()).toBe('https://admin.jeffistores.in')
    process.env.ADMIN_BASE_URL = 'https://panel.x'
    expect(currentAdminBaseUrl()).toBe('https://panel.x')
  })
  it('platformOAuthBaseUrl strips a trailing /admin and slash', () => {
    process.env.ADMIN_BASE_URL = 'https://admin.x/admin/'
    expect(platformOAuthBaseUrl()).toBe('https://admin.x')
    delete process.env.ADMIN_BASE_URL
    expect(platformOAuthBaseUrl()).toBe('https://admin.jeffistores.in')
  })
  it('currentStoreUrl: tenant vs platform', () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme' } as any)
    expect(currentStoreUrl()).toBe('https://acme.jeffistores.in')
    vi.mocked(getCurrentTenant).mockReturnValue(null)
    process.env.APP_URL = 'https://shop.x'
    expect(currentStoreUrl()).toBe('https://shop.x')
  })
})

describe('customerMailFrom (sync)', () => {
  it('tenant name + noreply address', () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: 'Acme' } as any)
    expect(customerMailFrom()).toBe('"Acme" <noreply-acme@jeffistores.in>')
  })
  it('falls back to "{slug} Store" when no display name', () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme' } as any)
    expect(customerMailFrom()).toBe('"acme Store" <noreply-acme@jeffistores.in>')
  })
  it('platform sender off-tenant', () => {
    expect(customerMailFrom()).toBe('"Jeffi Stores" <noreply@jeffistores.in>')
    process.env.SES_FROM_EMAIL = 'hi@x.com'
    expect(customerMailFrom()).toBe('"Jeffi Stores" <hi@x.com>')
  })
})

describe('adminMailFrom', () => {
  it('always the platform, env precedence admin → from → default', () => {
    expect(adminMailFrom()).toBe('"Jeffi Stores" <noreply@jeffistores.in>')
    process.env.SES_FROM_EMAIL = 'from@x'
    expect(adminMailFrom()).toBe('"Jeffi Stores" <from@x>')
    process.env.SES_ADMIN_FROM_EMAIL = 'admin@x'
    expect(adminMailFrom()).toBe('"Jeffi Stores" <admin@x>')
  })
})

describe('resolveCurrentTenant (async)', () => {
  it('returns the ALS tenant directly when it has a slug', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: 'Acme', plan: 'pro' } as any)
    expect(await resolveCurrentTenant()).toEqual({ slug: 'acme', displayName: 'Acme', plan: 'pro' })
    expect(headers).not.toHaveBeenCalled()
  })
  it('null when no ALS slug and no header', async () => {
    expect(await resolveCurrentTenant()).toBeNull()
  })
  it('looks the slug up via the registry when the header has one', async () => {
    vi.mocked(headers).mockResolvedValue({ get: () => 'acme' } as any)
    vi.mocked(lookupTenantContextBySlug).mockResolvedValue({ slug: 'acme', displayName: 'Acme Co', plan: 'basic' } as any)
    expect(await resolveCurrentTenant()).toEqual({ slug: 'acme', displayName: 'Acme Co', plan: 'basic' })
  })
  it('falls back to a bare slug ctx when the lookup misses', async () => {
    vi.mocked(headers).mockResolvedValue({ get: () => 'ghost' } as any)
    vi.mocked(lookupTenantContextBySlug).mockResolvedValue(null as any)
    expect(await resolveCurrentTenant()).toEqual({ slug: 'ghost', displayName: null, plan: null })
  })
  it('null when the dynamic import throws', async () => {
    vi.mocked(headers).mockRejectedValue(new Error('no headers'))
    expect(await resolveCurrentTenant()).toBeNull()
  })
})

describe('async URL / sender helpers', () => {
  it('storeBaseUrlAsync: tenant host vs platform', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme' } as any)
    expect(await storeBaseUrlAsync()).toBe('https://acme.jeffistores.in')
    vi.mocked(getCurrentTenant).mockReturnValue(null)
    expect(await storeBaseUrlAsync()).toBe('https://jeffistores.in')
  })

  it('businessBaseUrlAsync: platform uses businessBaseUrl()', async () => {
    expect(await businessBaseUrlAsync()).toBe('https://biz.example')
  })
  it('businessBaseUrlAsync: pro/enterprise get their own business host', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', plan: 'pro' } as any)
    expect(await businessBaseUrlAsync()).toBe('https://acme.business.jeffistores.in')
  })
  it('businessBaseUrlAsync: other plans get storefront + /business', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', plan: 'basic' } as any)
    expect(await businessBaseUrlAsync()).toBe('https://acme.jeffistores.in/business')
  })

  it('currentAdminBaseUrlAsync: tenant vs platform', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme' } as any)
    expect(await currentAdminBaseUrlAsync()).toBe('https://admin-acme.jeffistores.in')
    vi.mocked(getCurrentTenant).mockReturnValue(null)
    expect(await currentAdminBaseUrlAsync()).toBe('https://admin.jeffistores.in')
  })

  it('customerMailFromAsync: tenant vs platform', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: 'Acme' } as any)
    expect(await customerMailFromAsync()).toBe('"Acme" <noreply-acme@jeffistores.in>')
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: null } as any)
    expect(await customerMailFromAsync()).toBe('"acme Store" <noreply-acme@jeffistores.in>')
    vi.mocked(getCurrentTenant).mockReturnValue(null)
    expect(await customerMailFromAsync()).toBe('"Jeffi Stores" <noreply@jeffistores.in>')
  })

  it('currentBrandNameAsync: tenant display, slug fallback, platform', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: ' Acme ' } as any)
    expect(await currentBrandNameAsync()).toBe('Acme')
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: null } as any)
    expect(await currentBrandNameAsync()).toBe('acme Store')
    vi.mocked(getCurrentTenant).mockReturnValue(null)
    expect(await currentBrandNameAsync()).toBe('Jeffi Stores')
  })

  it('campaignMailFromAsync: tenant campaigns addr, then promo→from→default', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: 'Acme' } as any)
    expect(await campaignMailFromAsync()).toBe('"Acme" <campaigns-acme@jeffistores.in>')
    vi.mocked(getCurrentTenant).mockReturnValue(null)
    expect(await campaignMailFromAsync()).toBe('"Jeffi Stores" <noreply@jeffistores.in>')
    process.env.SES_FROM_EMAIL = 'from@x'
    expect(await campaignMailFromAsync()).toBe('"Jeffi Stores" <from@x>')
    process.env.SES_PROMO_FROM_EMAIL = 'promo@x'
    expect(await campaignMailFromAsync()).toBe('"Jeffi Stores" <promo@x>')
  })
})

describe('site-controls backed helpers', () => {
  it('storeContactLine joins phone and email, empty on error', async () => {
    vi.mocked(getStoreIdentity).mockResolvedValue({ phone: ' 123 ', email: 'a@b.com ' } as any)
    expect(await storeContactLine()).toBe('123 | a@b.com')
    vi.mocked(getStoreIdentity).mockResolvedValue({ phone: '', email: '' } as any)
    expect(await storeContactLine()).toBe('')
    vi.mocked(getStoreIdentity).mockRejectedValue(new Error('x'))
    expect(await storeContactLine()).toBe('')
  })
  it('storeMailTheme returns the accent, empty on error', async () => {
    vi.mocked(getStoreIdentity).mockResolvedValue({ emailAccent: '#fff' } as any)
    expect(await storeMailTheme()).toEqual({ accent: '#fff' })
    vi.mocked(getStoreIdentity).mockResolvedValue({} as any)
    expect(await storeMailTheme()).toEqual({ accent: '' })
    vi.mocked(getStoreIdentity).mockRejectedValue(new Error('x'))
    expect(await storeMailTheme()).toEqual({ accent: '' })
  })
  it('storeSignature prefers identity, falls back to brand/domain', async () => {
    vi.mocked(getStoreIdentity).mockResolvedValue({ name: ' Acme ', web: ' acme.com ' } as any)
    expect(await storeSignature()).toEqual({ name: 'Acme', web: 'acme.com' })
    vi.mocked(getStoreIdentity).mockResolvedValue({} as any)
    expect(await storeSignature()).toEqual({ name: 'Jeffi Stores', web: 'jeffistores.in' })
    vi.mocked(getStoreIdentity).mockRejectedValue(new Error('x'))
    expect(await storeSignature()).toEqual({ name: 'Jeffi Stores', web: 'jeffistores.in' })
  })
})

describe('db-backed helpers', () => {
  it('storeAddressLine returns the trimmed business_address, empty on error', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ value: ' 1 Main St ' }] as any)
    expect(await storeAddressLine()).toBe('1 Main St')
    vi.mocked(queryMany).mockResolvedValue([] as any)
    expect(await storeAddressLine()).toBe('')
    vi.mocked(queryMany).mockRejectedValue(new Error('x'))
    expect(await storeAddressLine()).toBe('')
  })
  it('storeOrigin maps city/state rows, empties on error', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { key: 'business_city', value: ' Pune ' },
      { key: 'business_state', value: 'MH' },
    ] as any)
    expect(await storeOrigin()).toEqual({ city: 'Pune', state: 'MH' })
    vi.mocked(queryMany).mockResolvedValue([] as any)
    expect(await storeOrigin()).toEqual({ city: '', state: '' })
    vi.mocked(queryMany).mockRejectedValue(new Error('x'))
    expect(await storeOrigin()).toEqual({ city: '', state: '' })
  })
})

describe('storeDescriptorForPrompt', () => {
  it('uses the tagline + truncated about', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: 'Acme' } as any)
    vi.mocked(getStorefrontContent).mockResolvedValue({ metaTagline: ' tools ', aboutCopy: 'x'.repeat(300) } as any)
    const d = await storeDescriptorForPrompt()
    expect(d.startsWith('Acme — tools.')).toBe(true)
    expect(d.length).toBeLessThan(300)
  })
  it('about only (no tagline)', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ slug: 'acme', displayName: 'Acme' } as any)
    vi.mocked(getStorefrontContent).mockResolvedValue({ metaTagline: '', aboutCopy: 'Great shop' } as any)
    expect(await storeDescriptorForPrompt()).toBe('Acme, an online store. Great shop')
  })
  it('neutral descriptor when nothing resolves or on error', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue(null)
    vi.mocked(getStorefrontContent).mockResolvedValue({} as any)
    expect(await storeDescriptorForPrompt()).toBe('Jeffi Stores, an online store')
    vi.mocked(getStorefrontContent).mockRejectedValue(new Error('x'))
    expect(await storeDescriptorForPrompt()).toBe('Jeffi Stores, an online store')
  })
})

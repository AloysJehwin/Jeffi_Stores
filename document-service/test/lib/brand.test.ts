import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = vi.hoisted(() => ({ PLATFORM_DOMAIN: 'jeffistores.in' }))

vi.mock('@jeffi/tenancy', () => ({
  currentTenant: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('../../src/lib/site-controls.js', () => ({
  getStoreIdentity: vi.fn(),
}))

import {
  platformBrandName,
  tenantNoReplyAddress,
  currentBrandNameAsync,
  customerMailFromAsync,
  storeBaseUrlAsync,
  businessBaseUrlAsync,
  currentAdminBaseUrlAsync,
  storeMailTheme,
  storeContactLine,
  storeAddressLine,
  storeOrigin,
} from '../../src/lib/brand.js'
import { currentTenant, queryMany } from '@jeffi/tenancy'
import { getStoreIdentity } from '../../src/lib/site-controls.js'

beforeEach(() => {
  vi.resetAllMocks()
  delete process.env.PLATFORM_BRAND_NAME
  delete process.env.SES_FROM_EMAIL
  delete process.env.APP_URL
  delete process.env.ADMIN_BASE_URL
})

describe('platformBrandName', () => {
  it('reads PLATFORM_BRAND_NAME env', () => {
    process.env.PLATFORM_BRAND_NAME = 'My Brand'
    expect(platformBrandName()).toBe('My Brand')
  })
  it('defaults to Jeffi Stores', () => {
    expect(platformBrandName()).toBe('Jeffi Stores')
  })
})

describe('tenantNoReplyAddress', () => {
  it('builds noreply address with slug and domain', () => {
    expect(tenantNoReplyAddress('acme')).toBe('noreply-acme@jeffistores.in')
  })
})

describe('currentBrandNameAsync', () => {
  it('prefers trimmed tenant displayName', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', displayName: '  Acme Inc  ' } as any)
    expect(await currentBrandNameAsync()).toBe('Acme Inc')
    expect(getStoreIdentity).not.toHaveBeenCalled()
  })
  it('falls back to store identity name', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', displayName: '' } as any)
    vi.mocked(getStoreIdentity).mockResolvedValue({ name: 'Store Name' } as any)
    expect(await currentBrandNameAsync()).toBe('Store Name')
  })
  it('falls back to `${slug} Store` when identity has no name', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', displayName: '' } as any)
    vi.mocked(getStoreIdentity).mockResolvedValue({ name: '' } as any)
    expect(await currentBrandNameAsync()).toBe('acme Store')
  })
  it('falls back to platform brand name when no tenant', async () => {
    vi.mocked(currentTenant).mockReturnValue(null as any)
    vi.mocked(getStoreIdentity).mockRejectedValue(new Error('no'))
    expect(await currentBrandNameAsync()).toBe('Jeffi Stores')
  })
})

describe('customerMailFromAsync', () => {
  it('uses tenant slug/displayName and noreply address', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', displayName: 'Acme' } as any)
    expect(await customerMailFromAsync()).toBe('"Acme" <noreply-acme@jeffistores.in>')
  })
  it('uses `${slug} Store` when displayName blank', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', displayName: '  ' } as any)
    expect(await customerMailFromAsync()).toBe('"acme Store" <noreply-acme@jeffistores.in>')
  })
  it('uses platform from with default SES when no slug', async () => {
    vi.mocked(currentTenant).mockReturnValue(null as any)
    expect(await customerMailFromAsync()).toBe('"Jeffi Stores" <noreply@jeffistores.in>')
  })
  it('honours SES_FROM_EMAIL env', async () => {
    process.env.SES_FROM_EMAIL = 'hi@x.com'
    vi.mocked(currentTenant).mockReturnValue(null as any)
    expect(await customerMailFromAsync()).toBe('"Jeffi Stores" <hi@x.com>')
  })
})

describe('storeBaseUrlAsync', () => {
  it('uses tenant subdomain when slug present', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme' } as any)
    expect(await storeBaseUrlAsync()).toBe('https://acme.jeffistores.in')
  })
  it('falls back to APP_URL then platform domain', async () => {
    vi.mocked(currentTenant).mockReturnValue(null as any)
    expect(await storeBaseUrlAsync()).toBe('https://jeffistores.in')
    process.env.APP_URL = 'https://app.example'
    expect(await storeBaseUrlAsync()).toBe('https://app.example')
  })
})

describe('businessBaseUrlAsync', () => {
  it('appends /business to store base when no slug', async () => {
    vi.mocked(currentTenant).mockReturnValue(null as any)
    expect(await businessBaseUrlAsync()).toBe('https://jeffistores.in/business')
  })
  it('uses business host for pro/enterprise plans', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', plan: 'pro' } as any)
    expect(await businessBaseUrlAsync()).toBe('https://acme.business.jeffistores.in')
  })
  it('uses /business path for non-business-host plans', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', plan: 'basic' } as any)
    expect(await businessBaseUrlAsync()).toBe('https://acme.jeffistores.in/business')
  })
})

describe('currentAdminBaseUrlAsync', () => {
  it('uses admin subdomain when slug present', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme' } as any)
    expect(await currentAdminBaseUrlAsync()).toBe('https://admin-acme.jeffistores.in')
  })
  it('falls back to ADMIN_BASE_URL then default', async () => {
    vi.mocked(currentTenant).mockReturnValue(null as any)
    expect(await currentAdminBaseUrlAsync()).toBe('https://admin.jeffistores.in')
    process.env.ADMIN_BASE_URL = 'https://admin.example'
    expect(await currentAdminBaseUrlAsync()).toBe('https://admin.example')
  })
})

describe('storeMailTheme', () => {
  it('returns accent from identity', async () => {
    vi.mocked(getStoreIdentity).mockResolvedValue({ emailAccent: '#abc' } as any)
    expect(await storeMailTheme()).toEqual({ accent: '#abc' })
  })
  it('empty accent when identity missing accent', async () => {
    vi.mocked(getStoreIdentity).mockResolvedValue({} as any)
    expect(await storeMailTheme()).toEqual({ accent: '' })
  })
  it('returns empty accent on error', async () => {
    vi.mocked(getStoreIdentity).mockRejectedValue(new Error('x'))
    expect(await storeMailTheme()).toEqual({ accent: '' })
  })
})

describe('storeContactLine', () => {
  it('joins phone and email', async () => {
    vi.mocked(getStoreIdentity).mockResolvedValue({ phone: ' 123 ', email: ' a@b.com ' } as any)
    expect(await storeContactLine()).toBe('123 | a@b.com')
  })
  it('drops blanks', async () => {
    vi.mocked(getStoreIdentity).mockResolvedValue({ phone: '', email: 'a@b.com' } as any)
    expect(await storeContactLine()).toBe('a@b.com')
  })
  it('returns empty on error', async () => {
    vi.mocked(getStoreIdentity).mockRejectedValue(new Error('x'))
    expect(await storeContactLine()).toBe('')
  })
})

describe('storeAddressLine', () => {
  it('returns trimmed first row value', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ value: '  42 Main Rd  ' }] as any)
    expect(await storeAddressLine()).toBe('42 Main Rd')
  })
  it('returns empty when no rows', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    expect(await storeAddressLine()).toBe('')
  })
})

describe('storeOrigin', () => {
  it('maps city and state from rows', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { key: 'business_city', value: ' Chennai ' },
      { key: 'business_state', value: 'Tamil Nadu' },
    ] as any)
    expect(await storeOrigin()).toEqual({ city: 'Chennai', state: 'Tamil Nadu' })
  })
  it('returns empty strings on error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('x'))
    expect(await storeOrigin()).toEqual({ city: '', state: '' })
  })
})

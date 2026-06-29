import { describe, it, expect, afterEach } from 'vitest'
import { bp, businessBaseUrl } from '@/lib/business-path'

describe('bp (business-path)', () => {
  it('returns path unchanged when host does not start with business.', () => {
    expect(bp('/business/products', 'www.example.com')).toBe('/business/products')
  })

  it('strips /business prefix on business. subdomain', () => {
    expect(bp('/business/products', 'business.jeffistores.in')).toBe('/products')
  })

  it('returns / when path is exactly /business on subdomain', () => {
    expect(bp('/business', 'business.jeffistores.in')).toBe('/')
  })

  it('strips /business from nested paths', () => {
    expect(bp('/business/cart', 'business.example.com')).toBe('/cart')
  })

  it('leaves non-business paths untouched on business subdomain', () => {
    expect(bp('/signin', 'business.jeffistores.in')).toBe('/signin')
  })

  it('handles empty path on business subdomain', () => {
    expect(bp('', 'business.example.com')).toBe('/')
  })

  it('works with localhost host', () => {
    expect(bp('/business/checkout', 'localhost:3000')).toBe('/business/checkout')
  })

  it('returns path unchanged when host is omitted and window is not defined (SSR)', () => {
    // In the test (Node) environment window is undefined, so h falls back to ''
    // '' does not start with 'business.' so path is returned as-is
    expect(bp('/business/products')).toBe('/business/products')
  })

  it('returns non-business path unchanged when host is omitted in SSR environment', () => {
    expect(bp('/signin')).toBe('/signin')
  })
})

describe('businessBaseUrl', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns BUSINESS_APP_URL when set without trailing slash', () => {
    process.env.BUSINESS_APP_URL = 'https://custom.example.com'
    expect(businessBaseUrl()).toBe('https://custom.example.com')
  })

  it('strips trailing slash from BUSINESS_APP_URL when present', () => {
    process.env.BUSINESS_APP_URL = 'https://custom.example.com/'
    expect(businessBaseUrl()).toBe('https://custom.example.com')
  })

  it('returns prod URL when NODE_ENV is production and BUSINESS_APP_URL is not set', () => {
    delete process.env.BUSINESS_APP_URL
    process.env.NODE_ENV = 'production'
    expect(businessBaseUrl()).toBe('https://business.jeffistores.in')
  })

  it('returns localhost URL when NODE_ENV is not production and BUSINESS_APP_URL is not set', () => {
    delete process.env.BUSINESS_APP_URL
    process.env.NODE_ENV = 'test'
    expect(businessBaseUrl()).toBe('http://localhost:3000/business')
  })
})

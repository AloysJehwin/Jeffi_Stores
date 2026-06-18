import { describe, it, expect } from 'vitest'
import { bp } from '@/lib/business-path'

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
})

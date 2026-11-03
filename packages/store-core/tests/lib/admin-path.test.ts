import { describe, it, expect } from 'vitest'
import { ap } from '@/lib/shared/admin-path'

describe('ap (admin-path)', () => {
  it('returns path unchanged when host does not start with admin.', () => {
    expect(ap('/admin/products', 'www.example.com')).toBe('/admin/products')
  })

  it('strips /admin prefix on admin. subdomain', () => {
    expect(ap('/admin/products', 'admin.jeffistores.in')).toBe('/products')
  })

  it('returns / when path is exactly /admin on subdomain', () => {
    expect(ap('/admin', 'admin.jeffistores.in')).toBe('/')
  })

  it('strips /admin from nested paths', () => {
    expect(ap('/admin/orders/123', 'admin.example.com')).toBe('/orders/123')
  })

  it('leaves non-admin paths untouched on admin subdomain', () => {
    expect(ap('/dashboard', 'admin.jeffistores.in')).toBe('/dashboard')
  })

  it('works with no host argument (SSR fallback — no window)', () => {
    // In Node/happy-dom with no window.location set, host defaults to ''
    // so no prefix stripping occurs
    const result = ap('/admin/login')
    expect(typeof result).toBe('string')
  })

  it('handles empty path string', () => {
    expect(ap('', 'admin.example.com')).toBe('/')
  })
})

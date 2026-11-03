import { describe, it, expect } from 'vitest'
import { adminCookieNameForHost, adminCookieDomainForHost } from '@/lib/auth/admin-cookie'

describe('the platform and a tenant admin never share a session cookie', () => {
  it('names the platform cookie admin_sid', () => {
    expect(adminCookieNameForHost('admin.jeffistores.in')).toBe('admin_sid')
  })

  it('gives a tenant admin host its own cookie name', () => {
    expect(adminCookieNameForHost('admin-acme.jeffistores.in')).toBe('admin_sid_t')
  })

  it('keeps the storefront and other app hosts on the platform cookie', () => {
    for (const h of ['jeffistores.in', 'acme.jeffistores.in', 'ecom.jeffistores.in', 'business.jeffistores.in']) {
      expect(adminCookieNameForHost(h), h).toBe('admin_sid')
    }
  })

  it('ignores a port suffix', () => {
    expect(adminCookieNameForHost('admin-acme.jeffistores.in:3000')).toBe('admin_sid_t')
  })

  it('scopes the tenant cookie to its own host, never the shared domain', () => {
    expect(adminCookieDomainForHost('admin-acme.jeffistores.in')).toEqual({})
  })
})

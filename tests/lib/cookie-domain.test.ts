import { describe, it, expect, vi, afterEach } from 'vitest'
import { getCookieDomain, cookieDomainOption } from '@/lib/auth/cookie-domain'

// ─────────────────────────────────────────────────────────────────────────────
// Helper to reset env between tests
// ─────────────────────────────────────────────────────────────────────────────
afterEach(() => {
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────────

describe('getCookieDomain', () => {
  describe('non-production environments', () => {
    it('returns undefined in development', () => {
      vi.stubEnv('NODE_ENV', 'development')
      expect(getCookieDomain()).toBeUndefined()
    })

    it('returns undefined in test environment', () => {
      vi.stubEnv('NODE_ENV', 'test')
      expect(getCookieDomain()).toBeUndefined()
    })

    it('returns undefined when NODE_ENV is empty string', () => {
      vi.stubEnv('NODE_ENV', '')
      expect(getCookieDomain()).toBeUndefined()
    })

    it('returns undefined for arbitrary non-production value', () => {
      vi.stubEnv('NODE_ENV', 'staging')
      expect(getCookieDomain()).toBeUndefined()
    })
  })

  describe('production environment', () => {
    it('returns COOKIE_DOMAIN env var when set in production', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', '.example.com')
      expect(getCookieDomain()).toBe('.example.com')
    })

    it('returns default .jeffistores.in when COOKIE_DOMAIN is not set', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', '')
      expect(getCookieDomain()).toBe('.jeffistores.in')
    })

    it('uses the apex-prefixed default (.jeffistores.in) for cross-subdomain sharing', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', '')
      const domain = getCookieDomain()
      // Must start with "." to cover all subdomains
      expect(domain).toMatch(/^\./)
    })

    it('respects a custom COOKIE_DOMAIN that includes a leading dot', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', '.custom-domain.io')
      expect(getCookieDomain()).toBe('.custom-domain.io')
    })

    it('respects a COOKIE_DOMAIN without a leading dot', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', 'specific.host.com')
      expect(getCookieDomain()).toBe('specific.host.com')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('cookieDomainOption', () => {
  describe('non-production environments', () => {
    it('returns an empty object in development (no domain key)', () => {
      vi.stubEnv('NODE_ENV', 'development')
      expect(cookieDomainOption()).toEqual({})
    })

    it('returns an empty object in test environment', () => {
      vi.stubEnv('NODE_ENV', 'test')
      expect(cookieDomainOption()).toEqual({})
    })

    it('does not include domain property when undefined', () => {
      vi.stubEnv('NODE_ENV', 'development')
      expect('domain' in cookieDomainOption()).toBe(false)
    })
  })

  describe('production environment', () => {
    it('returns { domain } with the value from COOKIE_DOMAIN', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', '.jeffistores.in')
      expect(cookieDomainOption()).toEqual({ domain: '.jeffistores.in' })
    })

    it('returns { domain: ".jeffistores.in" } when COOKIE_DOMAIN is unset', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', '')
      expect(cookieDomainOption()).toEqual({ domain: '.jeffistores.in' })
    })

    it('includes domain key in returned object', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', '')
      expect('domain' in cookieDomainOption()).toBe(true)
    })

    it('can be spread into a cookie options object', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('COOKIE_DOMAIN', '.jeffistores.in')
      const cookieOpts = {
        httpOnly: true,
        secure: true,
        ...cookieDomainOption(),
      }
      expect(cookieOpts).toEqual({
        httpOnly: true,
        secure: true,
        domain: '.jeffistores.in',
      })
    })

    it('spreading in development does not add domain to cookie options', () => {
      vi.stubEnv('NODE_ENV', 'development')
      const cookieOpts = {
        httpOnly: true,
        ...cookieDomainOption(),
      }
      expect(cookieOpts).toEqual({ httpOnly: true })
      expect('domain' in cookieOpts).toBe(false)
    })
  })
})

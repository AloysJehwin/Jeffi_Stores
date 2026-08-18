import { describe, it, expect, beforeAll } from 'vitest'
import { slugFromHost, RESERVED_LABELS } from '@/lib/tenant-registry'

// Pure host-parsing logic (no DB). Verifies subdomain -> slug extraction, the
// reserved-word blacklist (so platform app hosts never resolve as tenants), and
// app-prefix stripping (admin-{tenant} etc.).
describe('slugFromHost', () => {
  it('extracts a tenant slug from {slug}.jeffistores.in', () => {
    expect(slugFromHost('acme.jeffistores.in')).toEqual({ slug: 'acme', isCustomDomain: false })
    expect(slugFromHost('acme.jeffistores.in:443')).toEqual({ slug: 'acme', isCustomDomain: false })
  })

  it('returns null slug for the apex (platform store)', () => {
    expect(slugFromHost('jeffistores.in')).toEqual({ slug: null, isCustomDomain: false })
  })

  it('treats reserved app subdomains as platform, not tenants', () => {
    for (const label of ['admin', 'business', 'forms', 'www', 'ecom', 'invoice', 'quotation', 'purchaseorder', 'api']) {
      expect(slugFromHost(`${label}.jeffistores.in`)).toEqual({ slug: null, isCustomDomain: false })
    }
  })

  it('strips app prefixes: admin-{tenant} / invoice-{tenant} -> tenant slug', () => {
    expect(slugFromHost('admin-acme.jeffistores.in')).toEqual({ slug: 'acme', isCustomDomain: false })
    expect(slugFromHost('invoice-acme.jeffistores.in')).toEqual({ slug: 'acme', isCustomDomain: false })
  })

  it('flags a non-platform host as a possible custom domain', () => {
    expect(slugFromHost('shop.acme.com')).toEqual({ slug: null, isCustomDomain: true })
  })

  it('does not treat localhost as a custom domain', () => {
    expect(slugFromHost('localhost')).toEqual({ slug: null, isCustomDomain: false })
  })

  it('rejects multi-level labels as invalid tenant slugs', () => {
    expect(slugFromHost('a.b.jeffistores.in')).toEqual({ slug: null, isCustomDomain: false })
  })

  it('RESERVED_LABELS contains the known platform app hosts', () => {
    expect(RESERVED_LABELS.has('admin')).toBe(true)
    expect(RESERVED_LABELS.has('ecom')).toBe(true)
  })
})

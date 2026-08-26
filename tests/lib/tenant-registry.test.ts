import { describe, it, expect, beforeAll } from 'vitest'
import { slugFromHost, appFromHost, RESERVED_LABELS } from '@/lib/tenant-registry'

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

  it('strips the forms- prefix and resolves {tenant}.business', () => {
    expect(slugFromHost('forms-acme.jeffistores.in')).toEqual({ slug: 'acme', isCustomDomain: false })
    expect(slugFromHost('acme.business.jeffistores.in')).toEqual({ slug: 'acme', isCustomDomain: false })
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

describe('appFromHost', () => {
  it('maps platform app hosts to their surface', () => {
    expect(appFromHost('admin.jeffistores.in')).toBe('admin')
    expect(appFromHost('invoice.jeffistores.in')).toBe('invoice')
    expect(appFromHost('business.jeffistores.in')).toBe('business')
    expect(appFromHost('forms.jeffistores.in')).toBe('forms')
  })

  it('maps tenant app hosts (dash form) to the same surface', () => {
    expect(appFromHost('admin-acme.jeffistores.in')).toBe('admin')
    expect(appFromHost('invoice-acme.jeffistores.in')).toBe('invoice')
    expect(appFromHost('quotation-acme.jeffistores.in')).toBe('quotation')
    expect(appFromHost('purchaseorder-acme.jeffistores.in')).toBe('purchaseorder')
    expect(appFromHost('forms-acme.jeffistores.in')).toBe('forms')
  })

  it('maps {tenant}.business to the business surface', () => {
    expect(appFromHost('acme.business.jeffistores.in')).toBe('business')
  })

  it('returns null for storefront, apex, ecom and localhost', () => {
    expect(appFromHost('acme.jeffistores.in')).toBeNull()
    expect(appFromHost('jeffistores.in')).toBeNull()
    expect(appFromHost('ecom.jeffistores.in')).toBeNull()
    expect(appFromHost('localhost')).toBeNull()
  })

  it('keeps the dev {app}.localhost form working', () => {
    expect(appFromHost('admin.localhost')).toBe('admin')
    expect(appFromHost('admin.localhost:3000')).toBe('admin')
  })
})

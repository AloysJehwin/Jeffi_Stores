import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { slugFromHost, appFromHost, documentHostForSlug, RESERVED_LABELS } from '../src/hosts'

// ROOT_DOMAIN is read at module load from env; the default 'jeffistores.in' applies here
// since these env vars are unset in the test env.
const ROOT = 'jeffistores.in'

describe('slugFromHost — flagship root', () => {
  it('returns null slug for the bare root domain', () => {
    expect(slugFromHost(ROOT)).toEqual({ slug: null, isCustomDomain: false })
  })

  it('strips a port before matching', () => {
    expect(slugFromHost(`${ROOT}:443`)).toEqual({ slug: null, isCustomDomain: false })
  })

  it('treats localhost as the root (no slug, not custom)', () => {
    expect(slugFromHost('localhost')).toEqual({ slug: null, isCustomDomain: false })
    expect(slugFromHost('localhost:3000')).toEqual({ slug: null, isCustomDomain: false })
  })
})

describe('slugFromHost — subdomain match', () => {
  it('extracts a plain store slug', () => {
    expect(slugFromHost(`acme.${ROOT}`)).toEqual({ slug: 'acme', isCustomDomain: false })
  })

  it('case-folds the hostname', () => {
    expect(slugFromHost(`ACME.${ROOT}`)).toEqual({ slug: 'acme', isCustomDomain: false })
  })

  it('extracts the bare slug from a business subdomain', () => {
    expect(slugFromHost(`acme.business.${ROOT}`)).toEqual({ slug: 'acme', isCustomDomain: false })
  })

  it('extracts the bare slug from an app-prefixed host', () => {
    expect(slugFromHost(`admin-acme.${ROOT}`)).toEqual({ slug: 'acme', isCustomDomain: false })
    expect(slugFromHost(`invoice-acme.${ROOT}`)).toEqual({ slug: 'acme', isCustomDomain: false })
    expect(slugFromHost(`www-acme.${ROOT}`)).toEqual({ slug: 'acme', isCustomDomain: false })
  })

  it('extracts slug under a *.localhost root', () => {
    expect(slugFromHost('acme.localhost')).toEqual({ slug: 'acme', isCustomDomain: false })
    expect(slugFromHost('admin-acme.localhost')).toEqual({ slug: 'acme', isCustomDomain: false })
  })
})

describe('slugFromHost — reserved and malformed labels', () => {
  it('rejects a reserved label as a slug', () => {
    for (const label of ['admin', 'api', 'www', 'ecom', 'platform']) {
      expect(slugFromHost(`${label}.${ROOT}`)).toEqual({ slug: null, isCustomDomain: false })
    }
  })

  it('rejects a label that still contains a dot', () => {
    expect(slugFromHost(`a.b.${ROOT}`)).toEqual({ slug: null, isCustomDomain: false })
  })

  it('every reserved label is in the exported set', () => {
    expect(RESERVED_LABELS.has('vault')).toBe(true)
    expect(RESERVED_LABELS.has('purchaseorder')).toBe(true)
  })
})

describe('slugFromHost — custom domains', () => {
  it('flags an unrelated public host as a custom domain', () => {
    expect(slugFromHost('shop.example.com')).toEqual({ slug: null, isCustomDomain: true })
  })

  it('does not flag an empty host as custom', () => {
    expect(slugFromHost('')).toEqual({ slug: null, isCustomDomain: false })
  })

  it('does not flag .local / loopback hosts as custom', () => {
    expect(slugFromHost('myhost.local')).toEqual({ slug: null, isCustomDomain: false })
    expect(slugFromHost('127.0.0.1')).toEqual({ slug: null, isCustomDomain: false })
  })
})

describe('appFromHost', () => {
  it('returns the app for an app-prefixed subdomain', () => {
    expect(appFromHost(`admin-acme.${ROOT}`)).toBe('admin')
    expect(appFromHost(`invoice-acme.${ROOT}`)).toBe('invoice')
    expect(appFromHost(`quotation-acme.${ROOT}`)).toBe('quotation')
    expect(appFromHost(`purchaseorder-acme.${ROOT}`)).toBe('purchaseorder')
    expect(appFromHost(`forms-acme.${ROOT}`)).toBe('forms')
    expect(appFromHost(`vault-acme.${ROOT}`)).toBe('vault')
  })

  it('returns business for a *.business subdomain', () => {
    expect(appFromHost(`acme.business.${ROOT}`)).toBe('business')
  })

  it('returns the app when the first label is exactly the app name', () => {
    expect(appFromHost(`admin.${ROOT}`)).toBe('admin')
  })

  it('matches a bare app prefix on a non-root host', () => {
    expect(appFromHost('admin')).toBe('admin')
  })

  it('returns null for a plain store subdomain', () => {
    expect(appFromHost(`acme.${ROOT}`)).toBeNull()
  })

  it('returns null for the root', () => {
    expect(appFromHost(ROOT)).toBeNull()
  })
})

describe('documentHostForSlug', () => {
  it('builds the document host', () => {
    expect(documentHostForSlug('invoice', 'acme')).toBe(`invoice-acme.${ROOT}`)
    expect(documentHostForSlug('quotation', 'acme')).toBe(`quotation-acme.${ROOT}`)
    expect(documentHostForSlug('purchaseorder', 'x')).toBe(`purchaseorder-x.${ROOT}`)
  })
})

describe('hosts — custom PLATFORM_ROOT_DOMAIN via re-import', () => {
  const OLD = process.env.PLATFORM_ROOT_DOMAIN
  beforeEach(() => {
    process.env.PLATFORM_ROOT_DOMAIN = 'example.io'
  })
  afterEach(() => {
    if (OLD === undefined) delete process.env.PLATFORM_ROOT_DOMAIN
    else process.env.PLATFORM_ROOT_DOMAIN = OLD
  })

  it('honours a configured root domain', async () => {
    vi.resetModules()
    const mod = await import('../src/hosts')
    expect(mod.slugFromHost('acme.example.io')).toEqual({ slug: 'acme', isCustomDomain: false })
    expect(mod.slugFromHost('example.io')).toEqual({ slug: null, isCustomDomain: false })
  })
})

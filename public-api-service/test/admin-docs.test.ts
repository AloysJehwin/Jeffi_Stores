import { describe, it, expect } from 'vitest'
import { PLATFORM_TENANT_ID } from '@jeffi/tenancy'
import { loadManifest, publicOrigin, storeSpec, flagshipSpec, specFor, adminPaths, type Manifest, type ManifestRoute } from '../src/admin-docs'
import type { PublicHost, StoreRef } from '../src/admin-gateway'

const ACME: StoreRef = { tenantId: 't-acme', slug: 'acme', name: 'Acme', planScopes: new Set(['orders:read']) }
const FLAG: StoreRef = { tenantId: PLATFORM_TENANT_ID, slug: null, name: 'Jeffi Stores', planScopes: null }
const storePh: PublicHost = { kind: 'store', host: 'public-acme.jeffistores.in', slug: 'acme' }
const storePhLocal: PublicHost = { kind: 'store', host: 'public-acme.localhost:3000', slug: 'acme' }
const flagPh: PublicHost = { kind: 'flagship', host: 'public.jeffistores.in' }

const route = (o: Partial<ManifestRoute> = {}): ManifestRoute => ({
  host: 'admin', method: 'GET', path: '/api/admin/x', gatewayPath: '/v1/admin/orders',
  pathParams: [], query: [], scope: 'orders:read', platform: null, body: null, summary: null, command: 'x', ...o,
} as ManifestRoute)

const manifest: Manifest = { manifestHash: 'h1', routes: [route(), route({ gatewayPath: '/v1/admin/gst', scope: 'gst:read' })] }

describe('admin-docs — publicOrigin', () => {
  it('production store host', () => {
    expect(publicOrigin(storePh, ACME)).toBe('https://public-acme.jeffistores.in')
  })
  it('local store host keeps the port and uses http', () => {
    expect(publicOrigin(storePhLocal, ACME)).toBe('http://public-acme.localhost:3000')
  })
  it('flagship host', () => {
    expect(publicOrigin(flagPh, FLAG)).toBe('https://public.jeffistores.in')
  })
})

describe('admin-docs — loadManifest', () => {
  it('returns null for a missing file', () => {
    expect(loadManifest('/no/such/manifest.json')).toBeNull()
  })
})

describe('admin-docs — storeSpec', () => {
  it("builds a store's spec with only its plan routes and the store server", () => {
    const spec: any = storeSpec(manifest, storePh, ACME)
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Acme Admin API')
    expect(spec.info['x-manifest-hash']).toBe('h1')
    expect(spec.servers[0].url).toBe('https://public-acme.jeffistores.in')
    expect(Object.keys(spec.paths)).toEqual(['/v1/admin/orders']) // gst not in plan
    expect(spec.components.securitySchemes.AdminToken).toBeDefined()
  })

  it('with no manifest, paths are empty', () => {
    const spec: any = storeSpec(null, storePh, ACME)
    expect(spec.paths).toEqual({})
    expect(spec.info['x-manifest-hash']).toBeUndefined()
  })
})

describe('admin-docs — flagshipSpec', () => {
  const base = { openapi: '3.1.0', info: { title: 'Jeffi Public API', description: 'base' }, paths: { '/v1/pricing': {} }, components: {} }

  it('merges admin + platform routes into the base document', () => {
    const doc: any = flagshipSpec(base, manifest, FLAG)
    expect(doc.paths['/v1/pricing']).toBeDefined()
    expect(doc.paths['/v1/admin/orders']).toBeDefined()
    expect(doc.paths['/v1/admin/gst']).toBeDefined()
    expect(doc.components.securitySchemes.AdminToken).toBeDefined()
    expect(doc.info['x-manifest-hash']).toBe('h1')
    expect(doc.info.description).toContain('base')
  })

  it('returns the base unchanged when there is no manifest', () => {
    const doc: any = flagshipSpec(base, null, FLAG)
    expect(doc.paths).toEqual({ '/v1/pricing': {} })
  })
})

describe('admin-docs — specFor', () => {
  it('flagship host → flagshipSpec; store host → storeSpec; caches per key', () => {
    const base = { openapi: '3.1.0', info: { title: 'x' }, paths: {}, components: {} }
    const flag: any = specFor(base, flagPh, FLAG, manifest)
    expect(flag.paths['/v1/admin/orders']).toBeDefined()
    const store: any = specFor(base, storePh, ACME, manifest)
    expect(store.info.title).toBe('Acme Admin API')
    // second call hits the cache (same object returned)
    expect(specFor(base, storePh, ACME, manifest)).toBe(store)
  })

  it('a null manifest still returns a document', () => {
    const base = { openapi: '3.1.0', info: { title: 'x' }, paths: {}, components: {} }
    const store: any = specFor(base, { kind: 'store', host: 'public-other.jeffistores.in', slug: 'other' }, { tenantId: 't-o', slug: 'other', name: 'Other', planScopes: new Set() }, null)
    expect(store.openapi).toBe('3.1.0')
  })
})

describe('admin-docs — operation body variants (branches)', () => {
  it('raw body → additionalProperties, bodyUnknown w/o body → documented placeholder, GET drops body', () => {
    const paths: any = adminPaths([
      route({ gatewayPath: '/v1/admin/raw', method: 'POST', body: { raw: true } as any }),
      route({ gatewayPath: '/v1/admin/unknown', method: 'POST', body: null, bodyUnknown: true }),
      route({ gatewayPath: '/v1/admin/geton', method: 'GET', body: { type: 'object' } as any }),
      route({ gatewayPath: '/v1/admin/plat', host: 'platform', platform: 'admin', scope: null }),
    ])
    expect(paths['/v1/admin/raw'].post.requestBody.content['application/json'].schema).toEqual({ type: 'object', additionalProperties: true })
    expect(paths['/v1/admin/unknown'].post.requestBody.description).toMatch(/not documented/)
    expect(paths['/v1/admin/geton'].get.requestBody).toBeUndefined()
    // platform route notes mention administrators only
    expect(paths['/v1/admin/plat'].get.description).toContain('Platform administrators only')
  })
})

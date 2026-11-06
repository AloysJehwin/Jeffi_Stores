import { describe, expect, it } from 'vitest'
import { adminUrl, baseUrl } from '../src/config'
import { resolveTarget } from '../src/http'
import { buildRequest } from '../src/manifest'
import type { ManifestRoute } from '../src/manifest-types'
import { CliError } from '../src/util'
import { JSON_HEADERS, run, testIo, tmpDir } from './helpers'

const route = (over: Partial<ManifestRoute>): ManifestRoute => ({
  id: 'x',
  host: 'admin',
  method: 'GET',
  path: '/api/admin/products/{id}',
  gatewayPath: '/v1/admin/products/{id}',
  file: '',
  pathParams: [{ name: 'id', catchAll: false, optional: false }],
  query: [],
  scope: null,
  scopeSource: null,
  scopes: [],
  guard: 'auth',
  platform: null,
  body: null,
  summary: null,
  command: 'products get',
  ...over,
})

describe('buildRequest', () => {
  it('fills path params, named query flags and --query', () => {
    const req = buildRequest(route({ query: ['per_page', 'from'] }), ['a b/c'], { named: { 'per-page': '50' }, query: ['x=1'] })
    expect(req).toEqual({ method: 'GET', path: '/api/admin/products/a%20b%2Fc', query: [['per_page', '50'], ['x', '1']], body: undefined })
  })

  it('merges --data, named body flags and dotted --field values', () => {
    const r = route({
      method: 'PATCH',
      body: { type: 'object', properties: { basePrice: { type: 'number' }, name: { type: 'string' }, tags: { type: 'array' } } },
    })
    const req = buildRequest(r, ['p1'], { data: '{"name":"Old","sku":"S1"}', named: { 'base-price': '12.5', tags: '["a"]' }, field: ['name=New', 'meta.active=true'] })
    expect(req.body).toEqual({ name: 'New', sku: 'S1', basePrice: 12.5, tags: ['a'], meta: { active: true } })
  })

  it('sends --file as multipart, with body flags as form fields', () => {
    const r = route({
      method: 'POST',
      bodyContentType: 'multipart/form-data',
      body: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, alt: { type: 'string' }, meta: { type: 'object' } } },
    })
    const req = buildRequest(r, ['p1'], { file: ['./a.png'], named: { alt: 'Front' }, field: ['meta.w=2'] })
    expect(req).toEqual({ method: 'POST', path: '/api/admin/products/p1', query: [], multipart: [['alt', 'Front'], ['meta', '{"w":2}'], ['file', { path: './a.png' }]] })
    expect(() => buildRequest(route({ method: 'POST', body: { type: 'object', properties: {} } }), ['p1'], { file: ['f=./a.png'] })).toThrow('JSON body')
  })

  it('joins catch-all params and refuses missing ones or a body on GET', () => {
    const r = route({ path: '/api/admin/messaging-templates/{path}', pathParams: [{ name: 'path', catchAll: true, optional: false }] })
    expect(buildRequest(r, [['v2', 'templates x']]).path).toBe('/api/admin/messaging-templates/v2/templates%20x')
    expect(() => buildRequest(route({}), [])).toThrow('Missing <id>')
    expect(() => buildRequest(route({}), ['1'], { field: ['a=1'] })).toThrow(CliError)
  })
})

describe('hosts', () => {
  it('derives per-store public and admin hosts', () => {
    expect(baseUrl({ store: 'acme' })).toBe('https://public-acme.jeffistores.in')
    expect(baseUrl({ store: 'flagship' })).toBe('https://public.jeffistores.in')
    expect(baseUrl({ store: 'acme', local: true })).toBe('http://public-acme.localhost:3000')
    expect(adminUrl({ store: 'flagship', local: true })).toBe('http://admin.localhost:3000')
    expect(adminUrl({ store: 'acme' })).toBe('https://admin-acme.jeffistores.in')
  })

  it('maps app paths to the gateway, and back for --direct', () => {
    const ctx = { base: 'https://public.jeffistores.in', adminBase: 'https://admin.jeffistores.in', direct: false }
    expect(resolveTarget('/api/admin/products/1?x=1', ctx)).toEqual({ url: 'https://public.jeffistores.in/v1/admin/products/1?x=1', platform: false })
    expect(resolveTarget('/api/admin/ecom/customers/overview', ctx)).toEqual({ url: 'https://public.jeffistores.in/v1/platform/ecom/customers/overview', platform: true })
    expect(resolveTarget('orders/9', ctx).url).toBe('https://public.jeffistores.in/v1/admin/orders/9')
    expect(() => resolveTarget('/api/brands', ctx)).toThrow('--direct')
    expect(resolveTarget('/v1/platform/ecom/x', { ...ctx, direct: true })).toEqual({ url: 'https://admin.jeffistores.in/api/admin/ecom/x', platform: true })
  })
})

describe('generated and curated commands', () => {
  it('sends a generated command to the store’s public host with the token', async () => {
    const t = testIo(tmpDir(), { JEFFI_TOKEN: 'jfc_test', JEFFI_STORE: 'acme' })
    t.agent
      .get('https://public-acme.jeffistores.in')
      .intercept({ path: '/v1/admin/products/p1', method: 'PATCH', headers: { authorization: 'Bearer jfc_test' }, body: b => JSON.parse(String(b)).basePrice === 10 })
      .reply(200, { ok: true, id: 'p1' }, JSON_HEADERS)
    await run(t.io, ['--json', 'products', 'update', 'p1', '--base-price', '10'])
    expect(JSON.parse(t.out.join(''))).toEqual({ ok: true, id: 'p1' })
  })

  it('lists products from the filters CSV export', async () => {
    const t = testIo(tmpDir(), { JEFFI_TOKEN: 'jsa_key' })
    t.agent
      .get('https://public.jeffistores.in')
      .intercept({ path: '/v1/admin/filters/products/export?search=bolt', method: 'GET' })
      .reply(200, 'Name,SKU\n"Bolt, M8",B8\nNut,N1\n', { headers: { 'content-type': 'text/csv', 'x-row-count': '2' } })
    await run(t.io, ['--json', 'products', 'list', '--search', 'bolt'])
    expect(JSON.parse(t.out.join(''))).toEqual([{ Name: 'Bolt, M8', SKU: 'B8' }, { Name: 'Nut', SKU: 'N1' }])
  })

  it('refuses platform commands on a store profile', async () => {
    const t = testIo(tmpDir(), { JEFFI_TOKEN: 'jfc_test', JEFFI_STORE: 'acme' })
    await expect(run(t.io, ['platform', 'customers', 'show', 't1'])).rejects.toThrow('flagship')
  })

  it('posts certs issue to the platform API on the flagship', async () => {
    const t = testIo(tmpDir(), { JEFFI_TOKEN: 'jfc_root' })
    t.agent
      .get('https://public.jeffistores.in')
      .intercept({ path: '/v1/platform/ecom/t1/certs/issue', method: 'POST', body: b => JSON.parse(String(b)).revokeExisting === true })
      .reply(200, { serial: 'AB12', emailed: true }, JSON_HEADERS)
    await run(t.io, ['--json', 'platform', 'certs', 'issue', 't1', '--revoke-existing'])
    expect(JSON.parse(t.out.join(''))).toMatchObject({ serial: 'AB12' })
  })
})

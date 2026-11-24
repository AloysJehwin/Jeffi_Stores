// node --test scripts/check-service-routes.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractRoutes, isReferenced, check } from './check-service-routes.mjs'

test('extractRoutes reads literal paths, typed generics, multi-line calls and prefixes', () => {
  const src = [
    "app.get('/healthz', h)",
    "app.post<{ Params: { id: string } }>('/a/:id/cancel', h)",
    "app.get<{ Body: Record<string, string> }>(",
    "  '/multi/:x',",
    "  h)",
    "v1.put('/templates/:id', h)",
    "app.all('/api/*', h)",
    "// app.get('/commented', h)",
    "app.get(`/tpl/${x}`, h)",
    "app.get('/healthz', again)",
  ].join('\n')
  assert.deepEqual(extractRoutes(src, { v1: '/v1' }), [
    { method: 'GET', path: '/healthz' },
    { method: 'POST', path: '/a/:id/cancel' },
    { method: 'GET', path: '/multi/:x' },
    { method: 'PUT', path: '/v1/templates/:id' },
    { method: 'ALL', path: '/api/*' },
  ])
})

test('isReferenced matches concrete and templated URLs, not other routes or other methods of a prefix', () => {
  assert.equal(isReferenced('/messages/bulk/:id/cancel', "inject({ url: '/messages/bulk/job1/cancel' })"), true)
  assert.equal(isReferenced('/messages/bulk/:id/cancel', 'inject({ url: `/messages/bulk/${id}/cancel` })'), true)
  assert.equal(isReferenced('/webhooks/twilio/status', "url: '/webhooks/twilio/status?m=m1'"), true)
  assert.equal(isReferenced('/api/*', "url: '/api/products?page=2'"), true)
  assert.equal(isReferenced('/messages/:id', "url: '/messages/bulk/j1/items'"), false)
  assert.equal(isReferenced('/messages', "url: '/messages/batch'"), false)
  assert.equal(isReferenced('/healthz', "expect(upstream).toBe('http://x.test/healthz2')"), false)
})

const routes = { svc: [{ method: 'GET', path: '/a' }, { method: 'POST', path: '/b/:id' }] }

test('check passes when every route is referenced or allowlisted', () => {
  assert.deepEqual(check({ routesByService: routes, testTextByService: { svc: "'/a' '/b/1'" }, allowlist: {} }), [])
  assert.deepEqual(check({ routesByService: routes, testTextByService: { svc: "'/a'" }, allowlist: { svc: ['POST /b/:id'] } }), [])
})

test('check fails on an untested route that is not allowlisted', () => {
  assert.deepEqual(check({ routesByService: routes, testTextByService: { svc: "'/a'" }, allowlist: {} }), ['svc: no test references POST /b/:id'])
})

test('check fails when an allowlisted route gained a test or no longer exists', () => {
  const p = check({ routesByService: routes, testTextByService: { svc: "'/a' '/b/1'" }, allowlist: { svc: ['POST /b/:id', 'GET /gone'] } })
  assert.equal(p.length, 2)
  assert.match(p[0], /POST \/b\/:id now has a test/)
  assert.match(p[1], /GET \/gone no longer exists/)
})

test('check fails on an allowlist entry for an unknown service', () => {
  assert.deepEqual(check({ routesByService: routes, testTextByService: {}, allowlist: { ghost: [] } }).slice(-1), ['allowlist names unknown service ghost'])
})

test('the repository passes its own route check (allowlist is shrink-only)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const out = execFileSync(process.execPath, [path.join(root, 'scripts/check-service-routes.mjs')], { encoding: 'utf8' })
  assert.match(out, /Fastify service routes are referenced/)
})

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { routeFor } from '@/lib/service-routing'
import { matchIngress } from '../../../../packages/store-core/tests/helpers/traefik-match'
import { platformIngressRoutes, renderPlatformRoutes, ROUTES_PATH } from '../../../../deploy/k8s/gen-routes'

const PLATFORM_DIR = join(__dirname, '../../../../deploy/k8s/platform')

const PATHS = [
  '/', '/products/drill', '/api/products', '/api/admin/orders', '/api/admin/ecom/kyc', '/api/cron/cancel-stale-orders',
  '/api/cron/wallet-drift', '/api/internal/import/worker', '/api/ecom/onboard', '/api/webhooks/razorpay', '/api/certportal/certs',
  '/_next/static/chunks/a.js', '/_next/image', '/_admin/_next/static/a.js', '/_business/_next/static/a.js',
  '/_controller/_next/static/a.js', '/images/logo.png', '/manifest.webmanifest', '/admin', '/admin/orders', '/admin/ecom',
  '/business', '/business/signin', '/ecom', '/ecom/customers', '/certportal', '/legal/terms', '/settings/compute-pricing',
  '/settings/ai-pricing', '/settings/site-controls', '/login',
]

describe('platform routes (49-routes.yaml)', () => {
  it('matches what gen-routes.ts renders', () => {
    expect(readFileSync(ROUTES_PATH, 'utf8')).toBe(renderPlatformRoutes())
  })

  // The platform's own hosts, and hosts no store claims (the catch-all), go where routeFor says.
  const HOSTS = [
    'jeffistores.in', 'www.jeffistores.in', 'forms.jeffistores.in', 'vault.jeffistores.in', 'business.jeffistores.in',
    'certificate.jeffistores.in', 'ecom.jeffistores.in', 'admin.jeffistores.in',
    'unknown.jeffistores.in', 'admin-unknown.jeffistores.in', 'unknown.business.jeffistores.in', 'vault-unknown.jeffistores.in',
  ]
  const secure = platformIngressRoutes().filter(o => o.spec.entryPoints.includes('websecure'))
  for (const host of HOSTS) {
    it(host, () => {
      for (const path of PATHS) {
        const hit = matchIngress(secure, host, path)
        expect(hit?.route.services[0].name, `${host}${path}`).toBe(`jeffi-stores-${routeFor(host, path)}-service`)
      }
    })
  }

  it('sends CloudFront (plain HTTP to the apex) where the apex goes', () => {
    const web = platformIngressRoutes().filter(o => o.spec.entryPoints.includes('web'))
    for (const path of PATHS) expect(matchIngress(web, 'jeffistores.in', path)?.route.services[0].name).toBe(`jeffi-stores-${routeFor('jeffistores.in', path)}-service`)
  })

  it('keeps the catch-all below every other platform route', () => {
    const catchAll = platformIngressRoutes().find(o => o.metadata.name === 'jeffi-stores-catch-all')!
    const top = Math.max(...catchAll.spec.routes.map(r => r.priority))
    // Other manifests: an explicit priority, or Traefik's default (the rule's length).
    const others: number[] = []
    for (const f of readdirSync(PLATFORM_DIR).filter(f => f.endsWith('.yaml') && f !== '49-routes.yaml')) {
      const lines = readFileSync(join(PLATFORM_DIR, f), 'utf8').split('\n')
      lines.forEach((l, i) => {
        const m = /^\s*- match: (.+)$/.exec(l)
        if (!m || m[1].startsWith('HostRegexp(`.+`)')) return // the HTTP→HTTPS redirect, on the web entry point only
        const p = /^\s*priority: (\d+)/.exec(lines[i + 1] ?? '')
        others.push(p ? Number(p[1]) : m[1].length)
      })
    }
    expect(others.length).toBeGreaterThan(0)
    expect(top).toBeLessThan(Math.min(...others))
  })
})

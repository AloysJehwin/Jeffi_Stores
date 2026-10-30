import { describe, it, expect, afterEach } from 'vitest'
import { routeFor, servesRequest } from '@/lib/service-routing'

describe('routeFor', () => {
  it.each([
    // control plane
    ['ecom.jeffistores.in', '/', 'controller'],
    ['ecom.jeffistores.in', '/dashboard/store', 'controller'],
    ['ecom.jeffistores.in', '/legal/terms', 'storefront'],
    ['certificate.jeffistores.in', '/certs', 'controller'],
    ['admin.jeffistores.in', '/ecom/customers', 'controller'],
    ['admin.jeffistores.in', '/settings/compute-pricing', 'controller'],
    ['admin.jeffistores.in', '/api/admin/ecom/customers', 'controller'],
    ['admin.jeffistores.in', '/_controller/_next/static/chunks/a.js', 'controller'],
    ['jeffistores.in', '/api/webhooks/razorpay', 'controller'],
    ['jeffistores.in', '/api/webhooks/twilio', 'controller'],
    ['jeffistores.in', '/api/internal/provisioning/worker', 'controller'],
    ['jeffistores.in', '/api/cron/fanout', 'controller'],
    ['jeffistores.in', '/api/cron/wallet-drift', 'controller'],
    // admin
    ['admin.jeffistores.in', '/', 'admin'],
    ['admin.jeffistores.in', '/settings', 'admin'],
    ['admin-acme.jeffistores.in', '/orders', 'admin'],
    ['admin-acme.jeffistores.in', '/ecom', 'admin'],
    ['admin-acme.jeffistores.in', '/api/admin/products', 'admin'],
    ['admin-acme.jeffistores.in', '/_next/static/chunks/a.js', 'admin'],
    ['acme.jeffistores.in', '/api/cron/cancel-stale-orders', 'admin'],
    // the store's public APIs answer every host
    ['admin-acme.jeffistores.in', '/api/orders/1/invoice', 'storefront'],
    ['acme.business.jeffistores.in', '/api/checkout', 'storefront'],
    ['acme.jeffistores.in', '/api/webhooks/razorpay/acme', 'storefront'],
    // business
    ['acme.business.jeffistores.in', '/', 'business'],
    ['business.localhost:3000', '/products', 'business'],
    // storefront, and public files on every host
    ['acme.jeffistores.in', '/', 'storefront'],
    ['shop.example.com', '/products/x', 'storefront'],
    ['vault-acme.jeffistores.in', '/library', 'storefront'],
    ['forms-acme.jeffistores.in', '/', 'storefront'],
    ['acme.business.jeffistores.in', '/images/business-hero.webp', 'storefront'],
    ['ecom.jeffistores.in', '/screenshots/a.png', 'storefront'],
    ['admin-acme.jeffistores.in', '/manifest.webmanifest', 'storefront'],
    ['admin-acme.jeffistores.in', '/_next/static/media/font.woff2', 'admin'],
  ])('%s%s → %s', (host, path, app) => {
    expect(routeFor(host, path)).toBe(app)
  })
})

describe('servesRequest', () => {
  afterEach(() => delete process.env.SERVICE_TENANT_SLUG)

  it('answers only what routeFor sends this app, plus probes', () => {
    expect(servesRequest('admin', { host: 'admin-acme.jeffistores.in', path: '/orders', tenantSlug: 'acme' })).toBe(true)
    expect(servesRequest('storefront', { host: 'admin-acme.jeffistores.in', path: '/orders', tenantSlug: 'acme' })).toBe(false)
    expect(servesRequest('controller', { host: 'acme.jeffistores.in', path: '/api/health', tenantSlug: 'acme' })).toBe(true)
    expect(servesRequest(null, { host: 'acme.jeffistores.in', path: '/ecom', tenantSlug: 'acme' })).toBe(true)
  })

  it("a store's pods refuse another store", () => {
    process.env.SERVICE_TENANT_SLUG = 'acme'
    expect(servesRequest('storefront', { host: 'acme.jeffistores.in', path: '/', tenantSlug: 'acme' })).toBe(true)
    expect(servesRequest('storefront', { host: 'other.jeffistores.in', path: '/', tenantSlug: 'other' })).toBe(false)
  })
})

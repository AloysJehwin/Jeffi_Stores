import { describe, it, expect } from 'vitest'
import { ADMIN_SCOPES, ALL_SCOPE_KEYS, getScopeForPath, hasScope, type ScopeDefinition } from '@/lib/scopes'

// ---------------------------------------------------------------------------
// ADMIN_SCOPES catalogue
// ---------------------------------------------------------------------------
describe('ADMIN_SCOPES', () => {
  it('is a non-empty array', () => {
    expect(ADMIN_SCOPES.length).toBeGreaterThan(0)
  })

  it('every scope has required fields', () => {
    for (const scope of ADMIN_SCOPES) {
      expect(typeof scope.key).toBe('string')
      expect(scope.key.length).toBeGreaterThan(0)
      expect(typeof scope.label).toBe('string')
      expect(typeof scope.description).toBe('string')
      expect(Array.isArray(scope.routes)).toBe(true)
      expect(scope.routes.length).toBeGreaterThan(0)
    }
  })

  it('all scope keys are unique', () => {
    const keys = ADMIN_SCOPES.map(s => s.key)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  it('includes known scopes', () => {
    const keys = ADMIN_SCOPES.map(s => s.key)
    expect(keys).toContain('products:read')
    expect(keys).toContain('orders:read')
    expect(keys).toContain('invoices:read')
    expect(keys).toContain('settings:read')
    expect(keys).toContain('dashboard:read')
    expect(keys).toContain('agent:read')
    expect(keys).toContain('audit:read')
  })
})

// ---------------------------------------------------------------------------
// ALL_SCOPE_KEYS
// ---------------------------------------------------------------------------
describe('ALL_SCOPE_KEYS', () => {
  it('contains the same keys as ADMIN_SCOPES in the same order', () => {
    expect(ALL_SCOPE_KEYS).toEqual(ADMIN_SCOPES.map(s => s.key))
  })

  it('contains no duplicates', () => {
    expect(new Set(ALL_SCOPE_KEYS).size).toBe(ALL_SCOPE_KEYS.length)
  })
})

// ---------------------------------------------------------------------------
// getScopeForPath
// ---------------------------------------------------------------------------
describe('getScopeForPath', () => {
  // --- Special-cased paths ---
  it('returns null for /admin/login', () => {
    expect(getScopeForPath('/admin/login')).toBeNull()
  })

  it('returns dashboard for /admin', () => {
    expect(getScopeForPath('/admin')).toBe('dashboard:read')
  })

  // --- UI routes (iterating ADMIN_SCOPES) ---
  it('returns products for /admin/products', () => {
    expect(getScopeForPath('/admin/products')).toBe('products:read')
  })

  it('returns products for a deep product path', () => {
    expect(getScopeForPath('/admin/products/123/edit')).toBe('products:read')
  })

  it('returns orders for /admin/orders', () => {
    expect(getScopeForPath('/admin/orders')).toBe('orders:read')
  })

  it('returns invoices for /admin/invoices', () => {
    expect(getScopeForPath('/admin/invoices')).toBe('invoices:read')
  })

  it('returns orders for /admin/orders/new (orders scope prefix wins in loop)', () => {
    // /admin/orders appears in the orders scope, and startsWith('/admin/orders/') matches
    // before the invoices scope's exact '/admin/orders/new' entry is reached.
    expect(getScopeForPath('/admin/orders/new')).toBe('orders:read')
  })

  it('returns settings for /admin/settings', () => {
    expect(getScopeForPath('/admin/settings')).toBe('settings:read')
  })

  it('returns agent for /admin/agent', () => {
    expect(getScopeForPath('/admin/agent')).toBe('agent:read')
  })

  // --- API routes ---
  it('maps /api/admin/products/... to products', () => {
    expect(getScopeForPath('/api/admin/products/abc')).toBe('products:read')
  })

  it('maps /api/admin/orders/create/... to invoices', () => {
    expect(getScopeForPath('/api/admin/orders/create/new')).toBe('invoices:read')
  })

  it('maps /api/admin/orders/... to orders', () => {
    expect(getScopeForPath('/api/admin/orders/123')).toBe('orders:read')
  })

  it('maps /api/admin/invoices/... to invoices', () => {
    expect(getScopeForPath('/api/admin/invoices/drafts')).toBe('invoices:read')
  })

  it('maps /api/admin/labels/... to labels', () => {
    expect(getScopeForPath('/api/admin/labels/products')).toBe('labels:read')
  })

  it('maps /api/admin/financial/... to financial', () => {
    expect(getScopeForPath('/api/admin/financial/summary')).toBe('financial:read')
  })

  it('maps /api/admin/inventory/... to inventory', () => {
    expect(getScopeForPath('/api/admin/inventory/stock')).toBe('inventory:read')
  })

  it('maps /api/admin/gst/... to gst', () => {
    expect(getScopeForPath('/api/admin/gst/reports')).toBe('gst:read')
  })

  it('maps /api/admin/customers/... to customers', () => {
    expect(getScopeForPath('/api/admin/customers/list')).toBe('customers:read')
  })

  it('maps /api/admin/users/... to settings', () => {
    expect(getScopeForPath('/api/admin/users/create')).toBe('settings:read')
  })

  it('maps /api/admin/reviews/... to reviews', () => {
    expect(getScopeForPath('/api/admin/reviews/pending')).toBe('reviews:read')
  })

  it('maps /api/admin/coupons/... to coupons', () => {
    expect(getScopeForPath('/api/admin/coupons/create')).toBe('coupons:read')
  })

  it('maps /api/admin/mailer/... to mailer', () => {
    expect(getScopeForPath('/api/admin/mailer/send')).toBe('mailer:read')
  })

  it('maps /api/admin/agent/... to agent', () => {
    expect(getScopeForPath('/api/admin/agent/chat')).toBe('agent:read')
  })

  it('maps /api/admin/audit/... to audit', () => {
    expect(getScopeForPath('/api/admin/audit/list')).toBe('audit:read')
  })

  it('maps /api/admin/cron/... to audit', () => {
    expect(getScopeForPath('/api/admin/cron/history')).toBe('audit:read')
  })

  it('maps /api/admin/traffic/... to its own traffic scope', () => {
    // Traffic analytics was split out of `dashboard` into a first-class scope so
    // plan tiers can gate analytics independently of the basic dashboard.
    expect(getScopeForPath('/api/admin/traffic/stats')).toBe('traffic:read')
  })

  it('maps /api/admin/packing-slips/... to packing_slips', () => {
    expect(getScopeForPath('/api/admin/packing-slips/generate')).toBe('packing_slips:read')
  })

  it('maps /api/admin/inflation/... to inflation', () => {
    expect(getScopeForPath('/api/admin/inflation/bulk')).toBe('inflation:read')
  })

  it('maps /api/admin/suppliers/... to inventory', () => {
    expect(getScopeForPath('/api/admin/suppliers/list')).toBe('inventory:read')
  })

  it('maps /api/admin/delhivery/... to its own delhivery scope', () => {
    // Delhivery was split out of `orders` into a first-class scope so plan tiers
    // can enable shipping independently of order management.
    expect(getScopeForPath('/api/admin/delhivery/track')).toBe('delhivery:read')
  })

  it('maps /api/admin/support/... to customers', () => {
    expect(getScopeForPath('/api/admin/support/tickets')).toBe('customers:read')
  })

  it('maps /api/admin/certificates/... to settings', () => {
    expect(getScopeForPath('/api/admin/certificates/upload')).toBe('settings:read')
  })

  it('maps /api/admin/cash-sale/... to invoices', () => {
    expect(getScopeForPath('/api/admin/cash-sale/create')).toBe('invoices:read')
  })

  it('maps /api/admin/catalog-enrichment/... to catalog_enrichment', () => {
    expect(getScopeForPath('/api/admin/catalog-enrichment/run')).toBe('catalog_enrichment:read')
  })

  it('maps /api/admin/replication/... to replication', () => {
    expect(getScopeForPath('/api/admin/replication/status')).toBe('replication:read')
  })

  it('maps /api/admin/business/customers/... to business_customers', () => {
    expect(getScopeForPath('/api/admin/business/customers/list')).toBe('business_customers:read')
  })

  it('maps /api/admin/business/rfqs/... to business_rfqs', () => {
    expect(getScopeForPath('/api/admin/business/rfqs/all')).toBe('business_rfqs:read')
  })

  it('maps /api/admin/business/discounts/... to business_customers', () => {
    expect(getScopeForPath('/api/admin/business/discounts/apply')).toBe('business_customers:read')
  })

  it('maps /api/admin/review-forms/... to review_forms', () => {
    expect(getScopeForPath('/api/admin/review-forms/create')).toBe('review_forms:read')
  })

  it('maps /api/admin/quotations/... to quotations', () => {
    expect(getScopeForPath('/api/admin/quotations/generate')).toBe('quotations:read')
  })

  it('returns null for /api/admin/suggest/...', () => {
    expect(getScopeForPath('/api/admin/suggest/products')).toBeNull()
  })

  it('returns null for /api/internal/cron-record/...', () => {
    expect(getScopeForPath('/api/internal/cron-record/run')).toBeNull()
  })

  it('maps /api/brands/... to brands', () => {
    expect(getScopeForPath('/api/brands/list')).toBe('brands:read')
  })

  it('maps /api/customers/... to customers', () => {
    expect(getScopeForPath('/api/customers/profile')).toBe('customers:read')
  })

  it('returns null for unrecognised path', () => {
    expect(getScopeForPath('/api/completely-unknown/path')).toBeNull()
    expect(getScopeForPath('/public/something')).toBeNull()
    expect(getScopeForPath('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// hasScope
// ---------------------------------------------------------------------------
describe('hasScope', () => {
  it('administrator always has access regardless of scopes array', () => {
    expect(hasScope('administrator', [], 'products:read')).toBe(true)
    expect(hasScope('administrator', [], 'settings:read')).toBe(true)
    expect(hasScope('administrator', ['orders:read'], 'products:read')).toBe(true)
  })

  it('super_admin is held to its scopes — a tenant owner is super_admin', () => {
    // The blanket bypass let every tenant owner past its plan entitlement.
    expect(hasScope('super_admin', [], 'products:read')).toBe(false)
    expect(hasScope('super_admin', ['orders:read'], 'products:read')).toBe(false)
    expect(hasScope('super_admin', ['products:read'], 'products:read')).toBe(true)
  })

  it('non-super_admin grants access when scope is in the list', () => {
    expect(hasScope('admin', ['products:read', 'orders:read'], 'products:read')).toBe(true)
    expect(hasScope('admin', ['products:read', 'orders:read'], 'orders:read')).toBe(true)
  })

  it('non-super_admin denies access when scope is not in the list', () => {
    expect(hasScope('admin', ['products:read'], 'orders:read')).toBe(false)
    expect(hasScope('admin', [], 'products:read')).toBe(false)
  })

  it('write scope implies read access', () => {
    expect(hasScope('admin', ['products:write'], 'products:read')).toBe(true)
    expect(hasScope('admin', ['orders:write'], 'orders:read')).toBe(true)
  })

  it('is case-sensitive for scope matching', () => {
    expect(hasScope('admin', ['Products:read'], 'products:read')).toBe(false)
  })

  it('handles empty role string (not super_admin)', () => {
    expect(hasScope('', ['products:read'], 'products:read')).toBe(true)
    expect(hasScope('', ['orders:read'], 'products:read')).toBe(false)
  })
})

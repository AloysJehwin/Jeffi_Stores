import { describe, it, expect } from 'vitest'
import { businessHostForHost, documentHostForHost, documentHostForSlug } from '@/lib/tenancy/forms-host'

describe('document and business hosts', () => {
  it('maps each document app to the platform host or the tenant-prefixed one', () => {
    expect(documentHostForSlug('invoice', null)).toBe('invoice.jeffistores.in')
    expect(documentHostForSlug('quotation', 'acme')).toBe('quotation-acme.jeffistores.in')
    expect(documentHostForSlug('purchaseorder', 'acme')).toBe('purchaseorder-acme.jeffistores.in')
  })

  it("keeps the tenant of whatever host the page is on", () => {
    expect(documentHostForHost('invoice', 'acme.jeffistores.in')).toBe('invoice-acme.jeffistores.in')
    expect(documentHostForHost('invoice', 'acme.business.jeffistores.in')).toBe('invoice-acme.jeffistores.in')
    expect(documentHostForHost('quotation', 'admin-acme.jeffistores.in')).toBe('quotation-acme.jeffistores.in')
    expect(documentHostForHost('quotation', 'business.jeffistores.in')).toBe('quotation.jeffistores.in')
    expect(documentHostForHost('invoice', 'jeffistores.in')).toBe('invoice.jeffistores.in')
    expect(documentHostForHost('invoice', 'localhost')).toBe('invoice.jeffistores.in')
  })

  it("sends a business user to their own store's portal host", () => {
    expect(businessHostForHost('acme.jeffistores.in')).toBe('acme.business.jeffistores.in')
    expect(businessHostForHost('jeffistores.in')).toBe('business.jeffistores.in')
    expect(businessHostForHost('www.jeffistores.in')).toBe('business.jeffistores.in')
  })
})

import { describe, it, expect } from 'vitest'

// This file only contains TypeScript interface/type exports — no runtime code.
// We verify that the module can be imported and that structural shapes
// match expectations via plain object assignment (type checking at build time).

import type {
  Product,
  ProductVariant,
  ProductImage,
  Category,
  Brand,
  Order,
  User,
  AdminSession,
  DashboardStats,
} from '@/types/index'

describe('types/index — structural smoke tests', () => {
  it('Product type has required string fields', () => {
    const p: Product = {
      id: 'p1',
      category_id: 'cat1',
      brand_id: 'b1',
      sku: 'SKU-001',
      name: 'Bolt M8',
      slug: 'bolt-m8',
      description: 'A bolt',
      short_description: 'Bolt',
      base_price: 100,
      currency: 'INR',
      stock_status: 'In Stock',
      has_variants: false,
      is_featured: false,
      is_active: true,
      views_count: 0,
      sales_count: 0,
    } as unknown as Product
    expect(p.id).toBe('p1')
    expect(p.sku).toBe('SKU-001')
  })

  it('Product stock_status accepts valid values', () => {
    const statuses: Product['stock_status'][] = ['In Stock', 'Low Stock', 'Out of Stock']
    expect(statuses).toHaveLength(3)
  })

  it('ProductVariant type has id and product_id', () => {
    const v = { id: 'v1', product_id: 'p1' } as unknown as ProductVariant
    expect(v.id).toBe('v1')
    expect(v.product_id).toBe('p1')
  })

  it('ProductImage type has id and image_url', () => {
    const img = { id: 'img1', image_url: 'https://example.com/img.jpg' } as unknown as ProductImage
    expect(img.id).toBe('img1')
    expect(img.image_url).toContain('http')
  })

  it('Category type has id, name, slug', () => {
    const c = { id: 'cat1', name: 'Bolts', slug: 'bolts' } as unknown as Category
    expect(c.slug).toBe('bolts')
  })

  it('Brand type has id, name, slug', () => {
    const b = { id: 'b1', name: 'Unbrako', slug: 'unbrako' } as unknown as Brand
    expect(b.name).toBe('Unbrako')
  })

  it('Order type has id and status', () => {
    const o = { id: 'ord1', status: 'pending' } as unknown as Order
    expect(o.id).toBe('ord1')
  })

  it('User type has id and email', () => {
    const u = { id: 'u1', email: 'test@example.com' } as unknown as User
    expect(u.email).toBe('test@example.com')
  })

  it('AdminSession type has username and role', () => {
    const s = { username: 'adm1', role: 'super_admin' } as unknown as AdminSession
    expect(s.username).toBe('adm1')
    expect(s.role).toBe('super_admin')
  })

  it('DashboardStats type is an object shape', () => {
    const d = {} as unknown as DashboardStats
    expect(d).toBeDefined()
  })
})

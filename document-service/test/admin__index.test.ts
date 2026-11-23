import { describe, it, expect, vi, beforeEach } from 'vitest'

// mount is captured; adminRoutes should register every route tuple against it.
vi.mock('../src/shim', () => ({ mount: vi.fn() }))

import { adminRoutes } from '../src/admin/index.js'
import { mount } from '../src/shim'

const app = {} as any

beforeEach(() => vi.clearAllMocks())

describe('adminRoutes', () => {
  it('registers every route via mount(app, method, path, handler)', async () => {
    await adminRoutes(app)
    const calls = vi.mocked(mount).mock.calls
    // Every call: (app, METHOD, '/...path', handlerFn)
    for (const [a, method, path, handler] of calls) {
      expect(a).toBe(app)
      expect(['GET', 'POST', 'PATCH', 'DELETE']).toContain(method)
      expect(String(path).startsWith('/')).toBe(true)
      expect(typeof handler).toBe('function')
    }
  })

  it('mounts the key invoice, quotation and PO endpoints', async () => {
    await adminRoutes(app)
    const tuples = vi.mocked(mount).mock.calls.map(c => `${c[1]} ${c[2]}`)
    expect(tuples).toContain('GET /admin/invoices')
    expect(tuples).toContain('POST /admin/invoices/drafts')
    expect(tuples).toContain('POST /admin/invoices/cash-sale')
    expect(tuples).toContain('POST /admin/orders/:id/einvoice')
    expect(tuples).toContain('DELETE /admin/orders/:id/einvoice')
    expect(tuples).toContain('POST /orders/:id/invoice/generate')
    expect(tuples).toContain('GET /admin/quotations')
    expect(tuples).toContain('POST /admin/quotations/:id/convert-to-invoice')
    expect(tuples).toContain('GET /admin/inventory/po/:id/pdf')
    expect(tuples).toContain('POST /admin/business/rfqs/:id/convert-to-quotation')
  })

  it('registers a sizeable set of routes (regression guard)', async () => {
    await adminRoutes(app)
    expect(vi.mocked(mount).mock.calls.length).toBeGreaterThan(40)
  })
})

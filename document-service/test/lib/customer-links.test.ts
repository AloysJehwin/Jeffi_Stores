import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({
  queryOne: vi.fn(),
  currentTenant: vi.fn(),
  ROOT_DOMAIN: 'jeffistores.in',
}))

vi.mock('../../src/lib/brand.js', () => ({
  businessBaseUrlAsync: vi.fn(),
  storeBaseUrlAsync: vi.fn(),
}))

import {
  customerBaseUrl,
  orderUrl,
  orderUrlById,
  documentUrl,
  invoiceUrlForOrder,
} from '../../src/lib/customer-links.js'
import { queryOne, currentTenant } from '@jeffi/tenancy'
import { businessBaseUrlAsync, storeBaseUrlAsync } from '../../src/lib/brand.js'

beforeEach(() => {
  vi.resetAllMocks()
  delete process.env.DEV_PUBLIC_PORT
  vi.mocked(businessBaseUrlAsync).mockResolvedValue('https://acme.business.jeffistores.in')
  vi.mocked(storeBaseUrlAsync).mockResolvedValue('https://acme.jeffistores.in')
  vi.mocked(currentTenant).mockReturnValue(null as any)
})

describe('customerBaseUrl', () => {
  it('returns business base when user is an approved business', async () => {
    vi.mocked(queryOne).mockResolvedValue({ approved: true } as any)
    expect(await customerBaseUrl('u1')).toBe('https://acme.business.jeffistores.in')
  })
  it('returns store base when not an approved business', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect(await customerBaseUrl('u1')).toBe('https://acme.jeffistores.in')
  })
  it('returns store base when no userId', async () => {
    expect(await customerBaseUrl(null)).toBe('https://acme.jeffistores.in')
    expect(queryOne).not.toHaveBeenCalled()
  })
})

describe('orderUrl', () => {
  it('encodes the order id', async () => {
    const url = await orderUrl('a/b c', null)
    expect(url).toBe('https://acme.jeffistores.in/account/orders/a%2Fb%20c')
  })
})

describe('orderUrlById', () => {
  it('looks up user_id then builds url', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as any) // orders lookup
      .mockResolvedValueOnce({ approved: true } as any) // approved business
    const url = await orderUrlById('ord-1')
    expect(url).toBe('https://acme.business.jeffistores.in/account/orders/ord-1')
  })
  it('passes null user when order not found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any)
    const url = await orderUrlById('ord-1')
    expect(url).toBe('https://acme.jeffistores.in/account/orders/ord-1')
  })
})

describe('documentUrl', () => {
  it('uses tenant subdomain host over https', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme' } as any)
    expect(await documentUrl('invoice', 'tok')).toBe('https://invoice-acme.jeffistores.in/tok')
  })
  it('uses plain app host when no slug', async () => {
    expect(await documentUrl('quotation', 'tok')).toBe('https://quotation.jeffistores.in/tok')
  })
  it('encodes the token', async () => {
    expect(await documentUrl('purchaseorder', 'a/b')).toBe('https://purchaseorder.jeffistores.in/a%2Fb')
  })
})

describe('invoiceUrlForOrder', () => {
  it('returns undefined when token missing', async () => {
    vi.mocked(queryOne).mockResolvedValue({ view_token: null, invoice_number: 'INV1' } as any)
    expect(await invoiceUrlForOrder('ord-1')).toBeUndefined()
  })
  it('returns undefined when invoice_number missing', async () => {
    vi.mocked(queryOne).mockResolvedValue({ view_token: 'tok', invoice_number: null } as any)
    expect(await invoiceUrlForOrder('ord-1')).toBeUndefined()
  })
  it('returns undefined when order not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect(await invoiceUrlForOrder('ord-1')).toBeUndefined()
  })
  it('returns the invoice document url when present', async () => {
    vi.mocked(queryOne).mockResolvedValue({ view_token: 'tok', invoice_number: 'INV1' } as any)
    expect(await invoiceUrlForOrder('ord-1')).toBe('https://invoice.jeffistores.in/tok')
  })
})

describe('documentUrl with localhost ROOT_DOMAIN', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.DEV_PUBLIC_PORT
  })

  async function load(rootDomain: string) {
    vi.doMock('@jeffi/tenancy', () => ({
      queryOne: vi.fn(),
      currentTenant: vi.fn().mockReturnValue(null),
      ROOT_DOMAIN: rootDomain,
    }))
    vi.doMock('../../src/lib/brand.js', () => ({
      businessBaseUrlAsync: vi.fn(),
      storeBaseUrlAsync: vi.fn(),
    }))
    return import('../../src/lib/customer-links.js')
  }

  it('uses http for .localhost hosts and appends DEV_PUBLIC_PORT', async () => {
    process.env.DEV_PUBLIC_PORT = '3005'
    const mod = await load('localhost')
    expect(await mod.documentUrl('invoice', 'tok')).toBe('http://invoice.localhost:3005/tok')
  })
})


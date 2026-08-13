import { describe, it, expect, vi, beforeEach } from 'vitest'

// Disabled / missing-config branches require the module-level client constants to differ.
// We re-mock the client with AMAZON_PUSH_DISABLED=true / SELLER_ID='' and re-import via isolate.

describe('amazon/sync disabled + config branches', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function commonMocks(clientOverrides: Record<string, any>) {
    vi.doMock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
    vi.doMock('@/lib/merchant/product-fetch', () => ({
      fetchAllActiveProducts: vi.fn().mockResolvedValue([]),
      fetchProduct: vi.fn().mockResolvedValue({ id: 'p1', sku: 'S', name: 'n', has_variants: false }),
    }))
    vi.doMock('@/lib/amazon/mapper', () => ({
      productToAmazonListings: vi.fn().mockReturnValue([]),
      productToAmazonOfferListing: vi.fn(),
    }))
    vi.doMock('@/lib/amazon/client', () => ({
      putListingsItem: vi.fn(),
      patchListingsItem: vi.fn(),
      validateListingsItem: vi.fn(),
      deleteListingsItem: vi.fn(),
      matchAsin: vi.fn(),
      AMAZON_PUSH_DISABLED: false,
      SELLER_ID: 'SELLER',
      ...clientOverrides,
    }))
  }

  it('syncAllProductsToAmazon returns disabled result when push disabled', async () => {
    commonMocks({ AMAZON_PUSH_DISABLED: true })
    const mod = await import('@/lib/amazon/sync')
    const r = await mod.syncAllProductsToAmazon()
    expect(r.errors[0].sku).toBe('__disabled__')
  })

  it('syncAllProductsToAmazon returns config error when SELLER_ID empty', async () => {
    commonMocks({ SELLER_ID: '' })
    const mod = await import('@/lib/amazon/sync')
    const r = await mod.syncAllProductsToAmazon()
    expect(r.errors[0].sku).toBe('__config__')
  })

  it('syncProductToAmazon no-ops when disabled', async () => {
    commonMocks({ AMAZON_PUSH_DISABLED: true })
    const client = await import('@/lib/amazon/client')
    const mod = await import('@/lib/amazon/sync')
    await mod.syncProductToAmazon('p1')
    expect(client.putListingsItem).not.toHaveBeenCalled()
  })

  it('deleteProductFromAmazon no-ops when SELLER_ID empty', async () => {
    commonMocks({ SELLER_ID: '' })
    const client = await import('@/lib/amazon/client')
    const mod = await import('@/lib/amazon/sync')
    await mod.deleteProductFromAmazon('S')
    expect(client.deleteListingsItem).not.toHaveBeenCalled()
  })

  it('validateProductForAmazon returns config row when SELLER_ID empty', async () => {
    commonMocks({ SELLER_ID: '' })
    const mod = await import('@/lib/amazon/sync')
    const out = await mod.validateProductForAmazon('p1')
    expect(out[0].sku).toBe('__config__')
  })
})

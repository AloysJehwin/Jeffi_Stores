import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const setParts = vi.hoisted(() => vi.fn())
vi.mock('@/components/visitor/site/code/parts/product/context', () => ({ setProductParts: setParts }))
vi.mock('@/components/visitor/pdp/ProductPageProvider', () => ({
  ProductPageProvider: ({ product, initialSkuParam, freeShippingThreshold, reviewSummary, children }: any) => (
    <div data-testid="provider" data-product={product.name} data-sku={initialSkuParam ?? ''} data-free={freeShippingThreshold ?? ''} data-reviews={reviewSummary ? 'yes' : 'no'}>
      {children}
    </div>
  ),
}))

import ProductPageParts from '@/components/visitor/site/code/parts/product/ProductPageParts'

beforeEach(() => setParts.mockClear())

describe('ProductPageParts', () => {
  it('publishes the product data for the server parts and wraps children in the client provider', () => {
    const product = { id: 'p1', name: 'Drill' } as any
    const related = [{ id: 'r1' }]
    const summary = { average: 4.5 } as any
    render(
      <ProductPageParts product={product} related={related} gstEnabled reviewSummary={summary} initialSkuParam="SKU1" freeShippingThreshold={999}>
        <p>Page content</p>
      </ProductPageParts>,
    )
    expect(setParts).toHaveBeenCalledWith({ product, related, gstEnabled: true, reviewSummary: summary })
    const provider = screen.getByTestId('provider')
    expect(provider).toHaveAttribute('data-product', 'Drill')
    expect(provider).toHaveAttribute('data-sku', 'SKU1')
    expect(provider).toHaveAttribute('data-free', '999')
    expect(provider).toHaveAttribute('data-reviews', 'yes')
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })

  it('defaults to no related products and no review summary', () => {
    render(<ProductPageParts product={{ id: 'p', name: 'Saw' } as any} gstEnabled={false}><i /></ProductPageParts>)
    expect(setParts).toHaveBeenCalledWith({ product: expect.anything(), related: [], gstEnabled: false, reviewSummary: null })
    expect(screen.getByTestId('provider')).toHaveAttribute('data-reviews', 'no')
  })
})

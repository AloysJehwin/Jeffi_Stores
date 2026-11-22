import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The on-device pitch line fires fetch / loads an LLM; stub it to a marker so this stays a pure render test.
vi.mock('@/components/on-device/ProductPitchLine', () => ({
  default: (p: { productName: string }) => <div data-testid="pitch">pitch:{p.productName}</div>,
}))

import ProductDescriptionCard from '@/components/visitor/pdp/ProductDescriptionCard'

describe('ProductDescriptionCard (render + branches)', () => {
  it('renders nothing when the product has no description', () => {
    const { container } = render(<ProductDescriptionCard product={{ name: 'Widget' }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the heading, the description text and the pitch line when a description is present', () => {
    render(
      <ProductDescriptionCard
        product={{ name: 'Widget', description: 'A sturdy widget.', brands: { name: 'Acme' }, categories: { name: 'Tools' } }}
      />
    )
    expect(screen.getByRole('heading', { name: 'Product Description' })).toBeInTheDocument()
    expect(screen.getByText('A sturdy widget.')).toBeInTheDocument()
    // Pitch line gets the product name forwarded.
    expect(screen.getByTestId('pitch')).toHaveTextContent('pitch:Widget')
  })

  it('preserves newlines in the description (whitespace-pre-line block)', () => {
    render(<ProductDescriptionCard product={{ name: 'W', description: 'line1\nline2' }} />)
    expect(screen.getByText(/line1/)).toHaveTextContent('line1 line2')
  })
})

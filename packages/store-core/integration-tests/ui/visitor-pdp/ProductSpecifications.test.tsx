import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProductSpecifications from '@/components/visitor/pdp/ProductSpecifications'

// Drives the real buildSpecGroups: feeds a product row, asserts the customer-facing groups/rows render.
// Handling flags render as an aria-labelled list; SKU gets a copy affordance.

describe('ProductSpecifications (render + branches)', () => {
  it('renders nothing when there are no specs or handling flags', () => {
    const { container } = render(<ProductSpecifications product={{}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the Key details group from column values', () => {
    render(<ProductSpecifications product={{ brands: { name: 'Acme' }, model_number: 'MX-100', color: 'Black' }} />)
    expect(screen.getByRole('heading', { name: 'Specifications' })).toBeInTheDocument()
    expect(screen.getByText('Key details')).toBeInTheDocument()
    expect(screen.getByText('Brand')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('MX-100')).toBeInTheDocument()
    expect(screen.getByText('Black')).toBeInTheDocument()
  })

  it('renders the handling-flag list for flagged products', () => {
    render(<ProductSpecifications product={{ fragile: true, flammable: true, sku: 'SKU1' }} />)
    const list = screen.getByRole('list', { name: 'Handling' })
    expect(list).toBeInTheDocument()
    expect(screen.getByText('Fragile')).toBeInTheDocument()
    expect(screen.getByText('Flammable')).toBeInTheDocument()
    expect(screen.queryByText('Hazardous')).not.toBeInTheDocument()
  })

  it('renders the SKU in the Product codes group with a copy affordance', () => {
    render(<ProductSpecifications product={{ sku: 'ABC-123' }} />)
    expect(screen.getByText('Product codes')).toBeInTheDocument()
    expect(screen.getByText('ABC-123')).toBeInTheDocument()
    // CopySku exposes an aria-label referencing the sku.
    expect(screen.getByRole('button', { name: /Copy SKU ABC-123/ })).toBeInTheDocument()
  })

  it('renders compliance chips in the Standards group', () => {
    render(<ProductSpecifications product={{ certifications: ['ISO 9001', 'CE'] }} />)
    expect(screen.getByText('Standards and safety')).toBeInTheDocument()
    expect(screen.getByText('ISO 9001')).toBeInTheDocument()
    expect(screen.getByText('CE')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BusinessCatalogClient from '@business/app/(business)/business/catalog/BusinessCatalogClient'

describe('BusinessCatalogClient', () => {
  it('shows the catalog heading and the coming-soon notice about negotiated prices', () => {
    render(<BusinessCatalogClient />)
    expect(screen.getByRole('heading', { name: 'Product Catalog' })).toBeInTheDocument()
    expect(screen.getByText(/Catalog coming soon/)).toHaveTextContent('your negotiated prices will appear here')
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import ProductSpecifications from '@/components/visitor/pdp/ProductSpecifications'

afterEach(cleanup)

describe('ProductSpecifications', () => {
  it('renders nothing when the product has nothing customer-facing', () => {
    const { container } = render(
      <ProductSpecifications product={{ brands: { name: null }, condition: 'new', specifications: { 'Package Type': 'Box' } }} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders grouped rows, chips, a copyable SKU and icon handling pills', () => {
    const { container } = render(
      <ProductSpecifications
        product={{
          brands: { name: 'GMF' },
          color: 'Silver',
          compliance_standard: 'IS 2269, DIN 912',
          specifications: { 'Thread Type': 'Metric', Material: 'Stainless Steel 304' },
          sku: 'GMF-912-M8',
          fragile: true,
          flammable: true,
          perishable: true,
        }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Specifications' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Key details' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Technical specifications' })).toBeTruthy()
    expect(screen.getByText('Stainless Steel 304')).toBeTruthy()
    expect(screen.getByText('Thread Type')).toBeTruthy()
    expect(screen.getByText('Metric')).toBeTruthy()
    expect(screen.getByText('IS 2269')).toBeTruthy()
    expect(screen.getByText('DIN 912')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy SKU GMF-912-M8' })).toBeTruthy()
    const pills = within(screen.getByRole('list', { name: 'Handling' })).getAllByRole('listitem')
    expect(pills.map(li => li.textContent)).toEqual(['Fragile', 'Flammable', 'Perishable'])
    expect(pills.every(li => li.querySelector('svg'))).toBe(true)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

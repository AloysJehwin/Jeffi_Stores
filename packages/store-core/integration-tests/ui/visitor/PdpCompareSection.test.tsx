import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import PdpCompareSection from '@/components/visitor/PdpCompareSection'

const prod = (id: string, over: Record<string, any> = {}) => ({
  id, name: `Product ${id}`, slug: `p-${id}`, price: 1000, mrp: null, image: null, brandName: 'Halo', categoryId: 'c1', ...over,
})

describe('PdpCompareSection', () => {
  it('shows the current product plus up to two related ones, marking the current as Viewing', () => {
    render(<PdpCompareSection currentProduct={prod('a')} relatedProducts={[prod('b'), prod('c'), prod('d')]} />)
    expect(screen.getByRole('heading', { name: 'Compare Similar Products' })).toBeInTheDocument()
    expect(screen.getByText('Viewing')).toBeInTheDocument()
    expect(screen.getByText('Product a')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Product b' })).toHaveAttribute('href', '/products/p-b')
    expect(screen.getByRole('link', { name: 'Product c' })).toBeInTheDocument()
    expect(screen.queryByText('Product d')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Change' })).toHaveLength(2)
  })

  it('links the full comparison with every shown id', () => {
    render(<PdpCompareSection currentProduct={prod('a')} relatedProducts={[prod('b'), prod('c')]} />)
    const links = screen.getAllByRole('link').filter(l => l.getAttribute('href') === '/compare?ids=a,b,c')
    expect(links).toHaveLength(2)
  })

  it('formats price and the discount only when MRP is higher', () => {
    render(<PdpCompareSection currentProduct={prod('a', { price: 750, mrp: 1000 })} relatedProducts={[prod('b', { price: 500, mrp: 500 })]} />)
    expect(screen.getByText('₹750.00')).toBeInTheDocument()
    expect(screen.getByText('25% off')).toBeInTheDocument()
    expect(screen.getAllByText(/% off/)).toHaveLength(1)
  })

  it('always shows a brand row and flags a differing brand', () => {
    render(<PdpCompareSection currentProduct={prod('a')} relatedProducts={[prod('b', { brandName: 'Other' }), prod('c', { brandName: null })]} />)
    const row = screen.getByText('Brand').closest('tr')!
    expect(within(row).getByText('Other').className).toContain('text-amber-600')
    expect(within(row).getByText('—')).toBeInTheDocument()
    expect(within(row).getAllByText('Halo')[0].className).not.toContain('text-amber-600')
  })

  it('shows spec rows only when some product has the data and highlights differences', () => {
    render(
      <PdpCompareSection
        currentProduct={prod('a', { material: 'Steel', weight: 2, warranty_months: 12, warranty_type: 'brand', certifications: ['ISI', 'BIS'], fragile: true, hazardous: true, gst_percentage: '18.00', net_weight_grams: 500, volume_ml: 250 }) as any}
        relatedProducts={[prod('b', { material: 'Brass', warranty_months: 1 }) as any]}
      />
    )
    const cell = (label: string) => screen.getByText(label).closest('tr')!
    expect(within(cell('Material')).getByText('Steel')).toBeInTheDocument()
    expect(within(cell('Material')).getByText('Brass').className).toContain('text-amber-600')
    expect(within(cell('Weight')).getByText('2 kg')).toBeInTheDocument()
    expect(within(cell('Warranty')).getByText('12 months (brand)')).toBeInTheDocument()
    expect(within(cell('Warranty')).getByText('1 month')).toBeInTheDocument()
    expect(within(cell('Certifications')).getByText('ISI, BIS')).toBeInTheDocument()
    expect(within(cell('Hazards')).getByText('Fragile, Hazardous')).toBeInTheDocument()
    expect(within(cell('GST')).getByText('18%')).toBeInTheDocument()
    expect(within(cell('Net Weight')).getByText('500 g')).toBeInTheDocument()
    expect(within(cell('Volume')).getByText('250 ml')).toBeInTheDocument()
    expect(screen.queryByText('Finish')).not.toBeInTheDocument()
    expect(screen.queryByText('HSN Code')).not.toBeInTheDocument()
  })

  it('swap menu: opens, excludes products already in other slots, and replaces the chosen slot', () => {
    render(<PdpCompareSection currentProduct={prod('a')} relatedProducts={[prod('b'), prod('c'), prod('d')]} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Change' })[0])
    const menu = screen.getAllByRole('button').filter(b => /Product/.test(b.textContent || '') && b.textContent !== 'Change')
    const names = menu.map(b => b.textContent)
    expect(names.some(n => n!.includes('Product b'))).toBe(true)
    expect(names.some(n => n!.includes('Product d'))).toBe(true)
    expect(names.some(n => n!.includes('Product c'))).toBe(false)
    fireEvent.mouseDown(menu.find(b => b.textContent!.includes('Product d'))!)
    expect(screen.queryByRole('link', { name: 'Product b' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Product d' })).toBeInTheDocument()
    expect(screen.getAllByRole('link').some(l => l.getAttribute('href') === '/compare?ids=a,d,c')).toBe(true)
  })

  it('closes the swap menu on an outside click', () => {
    render(<PdpCompareSection currentProduct={prod('a')} relatedProducts={[prod('b'), prod('c')]} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Change' })[0])
    expect(screen.getAllByRole('button').length).toBeGreaterThan(2)
    fireEvent.mouseDown(document.body)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('renders with only the current product', () => {
    render(<PdpCompareSection currentProduct={prod('a', { image: '/a.png' })} relatedProducts={[]} />)
    expect(screen.getByAltText('Product a')).toHaveAttribute('src', '/a.png')
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
  })
})

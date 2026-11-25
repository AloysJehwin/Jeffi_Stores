import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const home = vi.hoisted(() => ({ value: null as any }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/ProductCard', () => ({
  default: ({ id, portal }: any) => <div data-testid="product" data-id={id} data-portal={portal} />,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: any) => <div data-testid="carousel" aria-label={ariaLabel}>{children}</div>,
}))
vi.mock('@/components/visitor/home/business/BusinessHomeProvider', () => ({
  useBusinessHome: () => home.value,
}))

import BusinessProducts from '@/components/visitor/home/business/BusinessProducts'

const href = (p: string) => p
const section = (over: any = {}) => ({ id: 's1', type: 'business_offers', title: null, subtitle: null, eyebrow: null, cta_label: null, cta_url: null, config: {}, ...over }) as any

beforeEach(() => {
  home.value = { status: 'ready', data: { company: { name: 'Acme', gstNumber: null }, offers: { s1: [{ id: 'a' }, { id: 'b' }] }, reorder: [{ id: 'r1' }] }, href }
})

describe('BusinessProducts', () => {
  it('renders nothing for a non-business section type', () => {
    const { container } = render(<BusinessProducts section={section({ type: 'hero' })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the offers as business-portal cards with a default view-all link', () => {
    render(<BusinessProducts section={section()} />)
    expect(screen.getByRole('heading', { name: 'Your business offers' })).toBeInTheDocument()
    expect(screen.getAllByTestId('product')).toHaveLength(2)
    expect(screen.getAllByTestId('product')[0].dataset.portal).toBe('business')
    expect(screen.getByRole('link', { name: /View all/ })).toHaveAttribute('href', '/business/products')
  })

  it('shows the reorder row from the reorder list without a view-all link', () => {
    render(<BusinessProducts section={section({ type: 'business_reorder' })} />)
    expect(screen.getByRole('heading', { name: 'Reorder your regulars' })).toBeInTheDocument()
    expect(screen.getAllByTestId('product')).toHaveLength(1)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('uses a custom CTA, routing /business paths through the host helper', () => {
    home.value.href = (p: string) => `/biz-host${p}`
    render(<BusinessProducts section={section({ cta_url: '/business/deals', cta_label: 'All deals' })} />)
    expect(screen.getByRole('link', { name: /All deals/ })).toHaveAttribute('href', '/biz-host/business/deals')
  })

  it('leaves an external CTA url alone', () => {
    render(<BusinessProducts section={section({ cta_url: 'https://example.com/x', cta_label: 'Elsewhere' })} />)
    expect(screen.getByRole('link', { name: /Elsewhere/ })).toHaveAttribute('href', 'https://example.com/x')
  })

  it('renders a carousel when the section is configured so', () => {
    render(<BusinessProducts section={section({ config: { layout: 'carousel' } })} />)
    expect(screen.getByTestId('carousel')).toBeInTheDocument()
  })

  it('shows skeletons while loading', () => {
    home.value = { status: 'loading', data: null, href }
    const { container } = render(<BusinessProducts section={section()} />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4)
    expect(screen.queryByTestId('product')).toBeNull()
  })

  it('hides for a visitor by default, and prompts to sign in when configured', () => {
    home.value = { status: 'visitor', data: null, href }
    const { container, rerender } = render(<BusinessProducts section={section()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<BusinessProducts section={section({ config: { visitor: 'signin' } })} />)
    expect(screen.getByText(/see your business prices/)).toBeInTheDocument()
    rerender(<BusinessProducts section={section({ type: 'business_reorder', config: { visitor: 'signin' } })} />)
    expect(screen.getByText(/reorder the products you buy most/)).toBeInTheDocument()
  })

  it('renders nothing on error or when there is nothing to show', () => {
    home.value = { status: 'error', data: null, href }
    const { container, rerender } = render(<BusinessProducts section={section()} />)
    expect(container).toBeEmptyDOMElement()
    home.value = { status: 'ready', data: { company: { name: null, gstNumber: null }, offers: {} }, href }
    rerender(<BusinessProducts section={section()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

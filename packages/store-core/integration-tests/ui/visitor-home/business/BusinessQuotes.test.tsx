import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const home = vi.hoisted(() => ({ value: null as any }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/home/business/BusinessHomeProvider', () => ({
  useBusinessHome: () => home.value,
}))

import BusinessQuotes from '@/components/visitor/home/business/BusinessQuotes'

const href = (p: string) => p
const section = (over: any = {}) => ({ id: 'q', type: 'business_quotes', title: null, subtitle: null, eyebrow: null, cta_label: null, cta_url: null, config: {}, ...over }) as any
const quotes = {
  open: 2,
  items: [
    { id: 'q1', rfqNumber: 'RFQ-001', status: 'pending', itemCount: 1, createdAt: '2026-03-05T00:00:00Z' },
    { id: 'q2', rfqNumber: 'RFQ-002', status: 'offer_accepted', itemCount: 4, createdAt: '2026-03-06T00:00:00Z' },
  ],
}

beforeEach(() => {
  home.value = { status: 'ready', data: { company: { name: 'Acme', gstNumber: null }, quotes }, href }
})

describe('BusinessQuotes', () => {
  it('renders nothing for a non-business type', () => {
    const { container } = render(<BusinessQuotes section={section({ type: 'hero' })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the request card (to the new-quote form) and the open quotes for a member', () => {
    render(<BusinessQuotes section={section()} />)
    expect(screen.getByRole('heading', { name: 'Buying in bulk?' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Request a quote/ })).toHaveAttribute('href', '/business/quotes/new')
    expect(screen.getByRole('heading', { name: /Open quotes/ })).toHaveTextContent('2')
    expect(screen.getByRole('link', { name: /RFQ-001/ })).toHaveAttribute('href', '/business/quotes/q1')
    expect(screen.getByText('1 item · 05 Mar 2026')).toBeInTheDocument()
    expect(screen.getByText('4 items · 06 Mar 2026')).toBeInTheDocument()
    expect(screen.getByText('Offer Accepted')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all quotes' })).toHaveAttribute('href', '/business/quotes')
  })

  it('caps the list at the section limit', () => {
    render(<BusinessQuotes section={section({ config: { limit: 1 } })} />)
    expect(screen.getByText('RFQ-001')).toBeInTheDocument()
    expect(screen.queryByText('RFQ-002')).toBeNull()
  })

  it('shows only the request card, linking to sign-in, for a visitor', () => {
    home.value = { status: 'visitor', data: null, href }
    render(<BusinessQuotes section={section({ title: 'Need a quote?', cta_label: 'Ask us' })} />)
    expect(screen.getByRole('heading', { name: 'Need a quote?' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ask us/ })).toHaveAttribute('href', '/business/signin')
    expect(screen.queryByText('Open quotes')).toBeNull()
  })

  it('shows placeholders while loading', () => {
    home.value = { status: 'loading', data: null, href }
    const { container } = render(<BusinessQuotes section={section()} />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })

  it('shows only the request card when a member has no open quotes', () => {
    home.value = { status: 'ready', data: { company: { name: 'A', gstNumber: null }, quotes: { open: 0, items: [] } }, href }
    render(<BusinessQuotes section={section()} />)
    expect(screen.queryByText(/Open quotes/)).toBeNull()
    expect(screen.getByRole('link', { name: /Request a quote/ })).toHaveAttribute('href', '/business/quotes/new')
  })
})

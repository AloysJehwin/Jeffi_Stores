import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const home = vi.hoisted(() => ({ value: null as any }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/home/business/BusinessHomeProvider', () => ({
  useBusinessHome: () => home.value,
}))

import BusinessAccount from '@/components/visitor/home/business/BusinessAccount'

const href = (p: string) => p
const section = (over: any = {}) => ({ id: 'a', type: 'business_account', title: null, subtitle: null, eyebrow: null, cta_label: null, cta_url: null, config: {}, ...over }) as any
const data = {
  company: { name: 'Acme Ltd', gstNumber: '29ABCDE1234F1Z5' },
  quotes: { open: 3, items: [] },
  account: {
    recentOrders: [{ id: 'o1', orderNumber: 'ORD-1', status: 'out_for_delivery', total: 2500, createdAt: '2026-03-05T00:00:00Z' }],
    paymentsDue: { count: 2, total: 12000 },
  },
}

beforeEach(() => {
  home.value = { status: 'ready', data, href }
})

describe('BusinessAccount', () => {
  it('renders nothing for a non-account type', () => {
    const { container } = render(<BusinessAccount section={section({ type: 'hero' })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows company, the three tiles and links for a signed-in business', () => {
    render(<BusinessAccount section={section()} />)
    expect(screen.getByRole('heading', { name: 'Account at a glance' })).toBeInTheDocument()
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument()
    expect(screen.getByText('GSTIN 29ABCDE1234F1Z5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ORD-1/ })).toHaveAttribute('href', '/business/account/orders/o1')
    expect(screen.getByText('Out For Delivery · 05 Mar 2026')).toBeInTheDocument()
    expect(screen.getByText(/2,500/)).toBeInTheDocument()
    expect(screen.getByText(/12,000/)).toBeInTheDocument()
    expect(screen.getByText('2 unpaid orders')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Quotes in progress')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all orders' })).toHaveAttribute('href', '/business/account/orders')
    expect(screen.getByRole('link', { name: 'View orders' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View quotes' })).toHaveAttribute('href', '/business/quotes')
  })

  it('shows empty states for no orders, nothing due and a single quote', () => {
    home.value = { status: 'ready', data: { company: { name: null, gstNumber: null }, quotes: { open: 1, items: [] }, account: { recentOrders: [], paymentsDue: { count: 0, total: 0 } } }, href }
    render(<BusinessAccount section={section()} />)
    expect(screen.getByText('Your business')).toBeInTheDocument()
    expect(screen.getByText('No orders yet.')).toBeInTheDocument()
    expect(screen.getByText('Nothing due')).toBeInTheDocument()
    expect(screen.getByText('Quote in progress')).toBeInTheDocument()
  })

  it('shows only the configured tiles and the sales contact', () => {
    render(<BusinessAccount section={section({ config: { tiles: ['orders'], contact: { name: 'Priya', phone: '+91 98765 43210', email: 'priya@acme.test' } } })} />)
    expect(screen.getByText('Recent orders')).toBeInTheDocument()
    expect(screen.queryByText('Payments due')).toBeNull()
    expect(screen.getByText('Priya')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+91 98765 43210' })).toHaveAttribute('href', 'tel:+919876543210')
    expect(screen.getByRole('link', { name: 'priya@acme.test' })).toHaveAttribute('href', 'mailto:priya@acme.test')
  })

  it('shows skeleton tiles while loading', () => {
    home.value = { status: 'loading', data: null, href }
    const { container } = render(<BusinessAccount section={section()} />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })

  it('hides for a visitor, or prompts sign-in when configured, and hides on error', () => {
    home.value = { status: 'visitor', data: null, href }
    const { container, rerender } = render(<BusinessAccount section={section()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<BusinessAccount section={section({ config: { visitor: 'signin' } })} />)
    expect(screen.getByText(/Sign in to see your orders/)).toBeInTheDocument()
    home.value = { status: 'error', data: null, href }
    rerender(<BusinessAccount section={section()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

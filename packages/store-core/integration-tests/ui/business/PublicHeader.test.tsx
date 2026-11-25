import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/ThemeToggle', () => ({ default: () => <button>theme-toggle</button> }))
const identity = { name: 'Halo Business', logoUrl: '/logo.png' }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity }) }))

import BusinessPublicHeader from '@/components/business/PublicHeader'

describe('BusinessPublicHeader', () => {
  it('shows the brand with logo and the section anchors', () => {
    render(<BusinessPublicHeader />)
    expect(screen.getAllByText('Halo Business')[0]).toBeInTheDocument()
    expect(screen.getAllByAltText('Halo Business Logo')[0]).toHaveAttribute('src', '/logo.png')
    expect(screen.getByRole('link', { name: 'Why Business' })).toHaveAttribute('href', '#advantages')
    expect(screen.getByRole('link', { name: 'How it Works' })).toHaveAttribute('href', '#how-it-works')
    expect(screen.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '#faq')
  })

  it('offers Sign In and Register to guests', () => {
    render(<BusinessPublicHeader authState="guest" />)
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/business/signin')
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/business/signup')
  })

  it('offers the portal to approved accounts', () => {
    render(<BusinessPublicHeader authState="approved" />)
    expect(screen.getByRole('link', { name: /Continue to Portal/ })).toHaveAttribute('href', '/business/products')
    expect(screen.queryByRole('link', { name: 'Register' })).toBeNull()
  })

  it('links pending accounts to the approval page', () => {
    render(<BusinessPublicHeader authState="pending" />)
    expect(screen.getByRole('link', { name: 'Approval Pending' })).toHaveAttribute('href', '/business/pending')
  })

  it('treats a rejected account like a guest', () => {
    render(<BusinessPublicHeader authState="rejected" />)
    expect(screen.getByRole('link', { name: 'Register' })).toBeInTheDocument()
  })

  it('opens the mobile drawer, locks scroll, and closes it again', () => {
    render(<BusinessPublicHeader />)
    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getAllByRole('link', { name: 'Register' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('closes the drawer when a link inside it is chosen', () => {
    render(<BusinessPublicHeader authState="pending" />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getAllByRole('link', { name: 'Approval Pending' })[1])
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull()
  })

  it('skips the logo when the store has none', () => {
    identity.logoUrl = ''
    render(<BusinessPublicHeader />)
    expect(screen.queryByAltText('Halo Business Logo')).toBeNull()
    identity.logoUrl = '/logo.png'
  })
})

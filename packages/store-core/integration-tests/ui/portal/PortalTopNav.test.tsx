import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
const cfg = { identity: { name: 'Halo Audio', web: 'halo.example.com' } }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => cfg }))

import PortalTopNav, { storeUrlFrom } from '@/components/portal/PortalTopNav'

describe('storeUrlFrom', () => {
  it('keeps an absolute url and prefixes a bare host', () => {
    expect(storeUrlFrom('https://a.com')).toBe('https://a.com')
    expect(storeUrlFrom(' a.com ')).toBe('https://a.com')
  })
  it('falls back to the current host when blank', () => {
    expect(storeUrlFrom('')).toMatch(/^https:\/\//)
  })
})

describe('PortalTopNav', () => {
  it('shows the store name, the surface title and the default shop link', () => {
    render(<PortalTopNav title="Certificate Portal" />)
    expect(screen.getByRole('link', { name: 'Halo Audio' })).toHaveAttribute('href', 'https://halo.example.com')
    expect(screen.getByText('Certificate Portal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Shop with us/ })).toHaveAttribute('href', 'https://halo.example.com')
  })

  it('honours homeHref and a custom right-hand action', () => {
    render(<PortalTopNav homeHref="/portal" right={<button>Sign out</button>} />)
    expect(screen.getByRole('link', { name: 'Halo Audio' })).toHaveAttribute('href', '/portal')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByText(/Shop with us/)).toBeNull()
  })

  it('falls back to "Our Store" with no configured name', () => {
    cfg.identity.name = ''
    render(<PortalTopNav />)
    expect(screen.getByText('Our Store')).toBeInTheDocument()
    cfg.identity.name = 'Halo Audio'
  })
})

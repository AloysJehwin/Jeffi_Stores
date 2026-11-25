import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

let cfg: any
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => cfg }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/visitor/CookieConsentBanner', () => ({ CookieSettingsLink: () => <button>Cookie settings</button> }))
vi.mock('@/components/visitor/site/PhotoCredits', () => ({
  default: ({ credits }: any) => (credits?.length ? <p>credits:{credits.length}</p> : null),
}))

import Footer from '@/components/visitor/Footer'

describe('Footer', () => {
  beforeEach(() => {
    cfg = {
      identity: { name: 'Halo Audio', email: 'hi@halo.test', logoUrl: null },
      storefront: { metaTagline: 'Sound, sorted' },
      chrome: undefined,
    }
  })

  it('shows brand initials, tagline, contact email, default link columns and the copyright', () => {
    render(<Footer />)
    expect(screen.getByText('HA')).toBeInTheDocument()
    expect(screen.getByText('Halo Audio')).toBeInTheDocument()
    expect(screen.getByText('Sound, sorted')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'hi@halo.test' })).toHaveAttribute('href', 'mailto:hi@halo.test')
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0)
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Halo Audio`))).toBeInTheDocument()
    expect(screen.queryByText('Cookie settings')).not.toBeInTheDocument()
  })

  it('uses the logo image and omits email/tagline when absent', () => {
    cfg.identity = { name: 'Halo Audio', email: '', logoUrl: '/logo.png' }
    cfg.storefront = {}
    const { container } = render(<Footer />)
    expect(container.querySelector('img[src="/logo.png"]')).not.toBeNull()
    expect(screen.queryByText('HA')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument()
  })

  it('renders Site Builder columns, a custom note, and cookie settings only in the last column', () => {
    cfg.chrome = {
      footer: {
        note: 'Made in India',
        columns: [
          { title: 'Shop', links: [{ href: '/products', label: 'All products' }] },
          { title: 'Help', links: [{ href: '/faq', label: 'FAQ' }] },
        ],
      },
    }
    render(<Footer cookieConsent photoCredits={[{} as any]} />)
    expect(screen.getByText('Made in India')).toBeInTheDocument()
    const shop = screen.getByRole('navigation', { name: 'Shop' })
    expect(within(shop).getByRole('link', { name: 'All products' })).toHaveAttribute('href', '/products')
    expect(within(shop).queryByText('Cookie settings')).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Help' })).getByText('Cookie settings')).toBeInTheDocument()
    expect(screen.getByText('credits:1')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// SiteBuilderTabs: two builder tabs, one carrying a "Live" badge. Pure props; next/link stubbed to an anchor.
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn(), showConfirm: vi.fn() }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/admin/kit/core', () => ({ api: vi.fn() }))

import SiteBuilderTabs from '@/components/admin/site-builder/SiteBuilderTabs'

const base = { siteHref: '/admin/settings/site-builder', homepageHref: '/admin/settings/homepage', siteStarted: true }

describe('SiteBuilderTabs (render + state)', () => {
  it('renders both builder tabs with their hrefs', () => {
    render(<SiteBuilderTabs active="site" live="homepage" {...base} />)
    const site = screen.getByRole('link', { name: /Site builder/ })
    const home = screen.getByRole('link', { name: /Block builder/ })
    expect(site).toHaveAttribute('href', base.siteHref)
    expect(home).toHaveAttribute('href', base.homepageHref)
  })

  it('marks the active tab with aria-current=page and the other without', () => {
    render(<SiteBuilderTabs active="homepage" live="homepage" {...base} />)
    expect(screen.getByRole('link', { name: /Block builder/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Site builder/ })).not.toHaveAttribute('aria-current')
  })

  it('shows the Live badge only on the live builder', () => {
    render(<SiteBuilderTabs active="site" live="site" {...base} />)
    const badges = screen.getAllByText('Live')
    expect(badges).toHaveLength(1)
    // The badge sits inside the Site Builder tab, not the Homepage one.
    expect(screen.getByRole('link', { name: /Site builder/ })).toHaveTextContent('Live')
    expect(screen.getByRole('link', { name: /Block builder/ })).not.toHaveTextContent('Live')
  })

  it('moves the Live badge when the live builder is the homepage', () => {
    render(<SiteBuilderTabs active="site" live="homepage" {...base} />)
    expect(screen.getByRole('link', { name: /Block builder/ })).toHaveTextContent('Live')
    expect(screen.getByRole('link', { name: /Site builder/ })).not.toHaveTextContent('Live')
  })

  it('offers to make the other builder live, and hides the site option until it has pages', () => {
    const { rerender } = render(<SiteBuilderTabs active="site" live="site" {...base} />)
    expect(screen.getByRole('button', { name: /Make block builder live/ })).toBeInTheDocument()
    rerender(<SiteBuilderTabs active="site" live="homepage" {...base} />)
    expect(screen.getByRole('button', { name: /Make site builder live/ })).toBeInTheDocument()
    rerender(<SiteBuilderTabs active="site" live="homepage" {...base} siteStarted={false} />)
    expect(screen.queryByRole('button', { name: /Make site builder live/ })).toBeNull()
  })
})

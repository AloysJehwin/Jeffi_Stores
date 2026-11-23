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

import SiteBuilderTabs from '@/components/admin/site-builder/SiteBuilderTabs'

const base = { siteHref: '/admin/settings/site-builder', homepageHref: '/admin/settings/homepage' }

describe('SiteBuilderTabs (render + state)', () => {
  it('renders both builder tabs with their hrefs', () => {
    render(<SiteBuilderTabs active="site" live="homepage" {...base} />)
    const site = screen.getByRole('link', { name: /Site Builder/ })
    const home = screen.getByRole('link', { name: /Homepage builder/ })
    expect(site).toHaveAttribute('href', base.siteHref)
    expect(home).toHaveAttribute('href', base.homepageHref)
  })

  it('marks the active tab with aria-current=page and the other without', () => {
    render(<SiteBuilderTabs active="homepage" live="homepage" {...base} />)
    expect(screen.getByRole('link', { name: /Homepage builder/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Site Builder/ })).not.toHaveAttribute('aria-current')
  })

  it('shows the Live badge only on the live builder', () => {
    render(<SiteBuilderTabs active="site" live="site" {...base} />)
    const badges = screen.getAllByText('Live')
    expect(badges).toHaveLength(1)
    // The badge sits inside the Site Builder tab, not the Homepage one.
    expect(screen.getByRole('link', { name: /Site Builder/ })).toHaveTextContent('Live')
    expect(screen.getByRole('link', { name: /Homepage builder/ })).not.toHaveTextContent('Live')
  })

  it('moves the Live badge when the live builder is the homepage', () => {
    render(<SiteBuilderTabs active="site" live="homepage" {...base} />)
    expect(screen.getByRole('link', { name: /Homepage builder/ })).toHaveTextContent('Live')
    expect(screen.getByRole('link', { name: /Site Builder/ })).not.toHaveTextContent('Live')
  })
})

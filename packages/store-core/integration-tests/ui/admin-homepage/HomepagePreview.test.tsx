import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// HomepagePreview: a Preview button that opens a portal modal with a device bar + iframe, plus the
// exported homepagePreviewUrl host builder. forms-host helpers are mocked so the prod-host branch is
// deterministic and independent of real tenancy host logic.
vi.mock('@/lib/tenancy/forms-host', () => ({
  storeHostForHost: (h: string) => `store.${h}`,
  businessHostForHost: (h: string) => `biz.${h}`,
}))

import HomepagePreviewButton, { homepagePreviewUrl } from '@/components/admin/homepage/HomepagePreview'

function setHost(hostname: string, port = '') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname, port },
  })
}

describe('homepagePreviewUrl (host builder)', () => {
  beforeEach(() => setHost('localhost'))

  it('builds a bare localhost store url with the preview token + layout query', () => {
    const u = homepagePreviewUrl('store', 'tok 1', 'desktop')
    expect(u).toBe('http://localhost/?preview=tok%201&layout=desktop')
  })

  it('prefixes the tenant slug subdomain on a *.localhost host and honours the port', () => {
    setHost('acme.localhost', '3000')
    const u = homepagePreviewUrl('store', 'tk', 'mobile')
    expect(u).toBe('http://acme.localhost:3000/?preview=tk&layout=mobile')
  })

  it('routes business audience under /business locally', () => {
    setHost('acme.localhost')
    const u = homepagePreviewUrl('business', 'tk', 'app')
    expect(u).toBe('http://acme.localhost/business?preview=tk&layout=app')
  })

  it('uses the storefront host helper on a production host', () => {
    setHost('admin.example.com')
    expect(homepagePreviewUrl('store', 'tk', 'desktop')).toBe('https://store.admin.example.com/?preview=tk&layout=desktop')
  })

  it('uses the business host helper for business audience in prod', () => {
    setHost('admin.example.com')
    expect(homepagePreviewUrl('business', 'tk', 'desktop')).toBe('https://biz.admin.example.com/?preview=tk&layout=desktop')
  })
})

describe('HomepagePreviewButton (render + open modal)', () => {
  beforeEach(() => setHost('localhost'))

  it('renders the Preview trigger and no dialog until clicked', () => {
    render(<HomepagePreviewButton token="tk" audience="store" />)
    expect(screen.getByRole('button', { name: /Preview/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the portal modal with the device bar and closes on the X', () => {
    render(<HomepagePreviewButton token="tk" audience="store" surface="web" />)
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }))
    const dialog = screen.getByRole('dialog', { name: 'Homepage preview' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // Device tabs are present.
    expect(screen.getByRole('button', { name: /Desktop/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Phone/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on the device matching the surface (web_mobile -> Phone pressed)', () => {
    render(<HomepagePreviewButton token="tk" audience="store" surface="web_mobile" />)
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }))
    expect(screen.getByRole('button', { name: /Phone/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Desktop/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the Business homepage marker for a business preview', () => {
    render(<HomepagePreviewButton token="tk" audience="business" surface="web" />)
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }))
    expect(screen.getByText('Business homepage')).toBeInTheDocument()
  })

  it('switching to the App tab shows the approximate-renderer note', () => {
    render(<HomepagePreviewButton token="tk" audience="store" surface="web" />)
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }))
    fireEvent.click(screen.getByRole('button', { name: /App/ }))
    expect(screen.getByText(/Approximate/)).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let ua = ''
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': ua }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Halo Audio', web: 'halo.example.com' } }) }))
vi.mock('@/contexts/PortalDeviceContext', async importOriginal => {
  const real = await importOriginal<typeof import('@/contexts/PortalDeviceContext')>()
  return real
})

import PortalShell, { isMobileUserAgent } from '@/components/portal/PortalShell'
import { useIsMobile } from '@/contexts/PortalDeviceContext'

const DeviceProbe = () => <span>{useIsMobile() ? 'device:mobile' : 'device:desktop'}</span>
const renderShell = async (props: Record<string, any> = {}) =>
  render(await PortalShell({ children: <DeviceProbe />, ...props }))

const brand = { badge: 'Certificates', heading: 'Verified', points: ['One', 'Two'], mobileIntro: 'Quick intro' }

describe('isMobileUserAgent', () => {
  it('detects phones and tablets, not desktops', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17)')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 14)')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(false)
    expect(isMobileUserAgent('')).toBe(false)
  })
})

describe('PortalShell', () => {
  it('desktop with a brand panel renders the split screen and the top nav', async () => {
    ua = 'Mozilla/5.0 (Macintosh)'
    await renderShell({ brand, navTitle: 'Portal' })
    expect(screen.getByText('device:desktop')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Verified' })).toBeInTheDocument()
    expect(screen.getByText('Portal')).toBeInTheDocument()
    expect(screen.queryByText('Quick intro')).toBeNull()
  })

  it('mobile shows the compact intro instead of the brand panel', async () => {
    ua = 'Mozilla/5.0 (iPhone)'
    await renderShell({ brand })
    expect(screen.getByText('device:mobile')).toBeInTheDocument()
    expect(screen.getByText('Quick intro')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Verified' })).toBeNull()
  })

  it('desktop without a brand is a centred column; hideNav drops the top bar', async () => {
    ua = 'Mozilla/5.0 (Macintosh)'
    await renderShell({ hideNav: true })
    expect(screen.getByText('device:desktop')).toBeInTheDocument()
    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('shows a custom right-hand nav action', async () => {
    ua = 'Mozilla/5.0 (Macintosh)'
    await renderShell({ navRight: <button>Sign out</button> })
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })
})

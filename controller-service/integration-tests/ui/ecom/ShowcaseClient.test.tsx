import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))

import ShowcaseClient from '@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/ShowcaseClient'

const original = window.location
afterEach(() => {
  Object.defineProperty(window, 'location', { value: original, writable: true })
})

const site = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1', slug: 'acme', name: 'Acme Studio', status: 'live', pauseReason: null, host: 'acme.jeffi.site', url: 'https://acme.jeffi.site', previewUrl: 'https://acme.jeffi.site/?p=1',
    hasPage: true, publishedAt: '2026-11-01T00:00:00Z', paidUntil: '2026-12-15T00:00:00Z', renew: true, lastChargeError: null, unreadLeads: 0, subscriptionStatus: 'active',
    autopay: true, checkoutUrl: null, endsAt: null, graceUntil: null, lineStatus: 'active', free: false, lapsed: false, priceInr: 200, trialEndsAt: null, ...over,
  }) as any
const view = (s: any, plans: any = null) =>
  render(
    <ToastProvider>
      <ShowcaseClient initial={s} tenantSlug="acme ws" plans={plans} />
    </ToastProvider>,
  )
const mockFetch = (ok: boolean, body: any) => {
  const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}
const action = (f: any) => JSON.parse(f.mock.calls[0][1].body).action

describe('ShowcaseClient', () => {
  it('a live paid site shows its address, status, price and navigation', () => {
    view(site())
    expect(screen.getByText('Acme Studio')).toBeInTheDocument()
    expect(screen.getByText('Live', { selector: 'span.rounded-full' })).toBeInTheDocument()
    expect(screen.getAllByText('acme.jeffi.site').length).toBeGreaterThan(0)
    expect(screen.getByText('₹200/month on your subscription')).toBeInTheDocument()
    expect(screen.getByText('Autopay').nextSibling).toHaveTextContent('On')
    expect(screen.getByRole('link', { name: /Open site/ })).toHaveAttribute('href', 'https://acme.jeffi.site/?p=1')
    expect(screen.getByRole('link', { name: /Analytics/ })).toHaveAttribute('href', '/dashboard/showcase/s1/analytics?tenant=acme%20ws')
    expect(screen.getByRole('link', { name: /Domain/ })).toHaveAttribute('href', '/dashboard/showcase/s1/domain?tenant=acme%20ws')
    expect(screen.getByText(/Online since/)).toBeInTheDocument()
  })

  it('copies the site address', async () => {
    const writeText = vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    view(site())
    fireEvent.click(screen.getByRole('button', { name: 'Copy the site address' }))
    expect(writeText).toHaveBeenCalledWith('https://acme.jeffi.site')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('counts unread enquiries', () => {
    view(site({ unreadLeads: 2 }))
    expect(screen.getByText("2 new enquiries from your site's contact form.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open enquiries' })).toHaveAttribute('href', '/dashboard/showcase/s1/leads?tenant=acme%20ws')
  })

  it('a draft without a page asks to finish it, and hides hosting and analytics', () => {
    view(site({ status: 'draft', hasPage: false, publishedAt: null }))
    expect(screen.getByText(/Your page isn't made yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Finish your page' })).toHaveAttribute('href', '/onboard/showcase?site=s1')
    expect(screen.queryByText('Hosting')).toBeNull()
    expect(screen.queryByRole('link', { name: /Analytics/ })).toBeNull()
  })

  it('publishes a finished draft and shows the new state', async () => {
    const f = mockFetch(true, site())
    view(site({ status: 'draft', publishedAt: null }))
    expect(screen.getByText(/Publishing puts it online: 7 days free, then ₹200\/month/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Publish/ }))
    expect(await screen.findByText('Your site is live')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/showcase/s1/hosting?tenant=acme%20ws')
    expect(action(f)).toBe('publish')
    expect(await screen.findByText(/Online since/)).toBeInTheDocument()
  })

  it('pauses a live site', async () => {
    const f = mockFetch(true, site({ status: 'paused', pauseReason: 'owner' }))
    view(site())
    fireEvent.click(screen.getByRole('button', { name: /Pause site/ }))
    expect(await screen.findByText('Your site is paused')).toBeInTheDocument()
    expect(action(f)).toBe('pause')
    expect(await screen.findByRole('button', { name: /Go live again/ })).toBeInTheDocument()
  })

  it('a site paused by the owner can go live again', async () => {
    const f = mockFetch(true, site())
    view(site({ status: 'paused', pauseReason: 'owner' }))
    expect(screen.getByText(/^Paused: visitors see a short note/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Go live again/ }))
    expect(await screen.findByText('Your site is live again')).toBeInTheDocument()
    expect(action(f)).toBe('resume')
  })

  it('a trial site offers autopay setup, and a payment-required answer sends the owner to Razorpay', async () => {
    const loc = { href: '' }
    Object.defineProperty(window, 'location', { value: loc, writable: true })
    const f = mockFetch(false, { checkoutUrl: 'https://rzp.io/auto' })
    view(site({ lineStatus: 'trial', free: true, autopay: false, trialEndsAt: '2026-11-30T00:00:00Z' }))
    expect(screen.getByText(/nothing is charged until 30 Nov 2026, then ₹200\/month/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Set up autopay/ }))
    expect(await screen.findByText('Opening Razorpay to approve autopay…')).toBeInTheDocument()
    expect(action(f)).toBe('autopay')
    expect(loc.href).toBe('https://rzp.io/auto')
  })

  it('shows the API error when an action fails', async () => {
    mockFetch(false, { error: 'Wallet locked' })
    view(site())
    fireEvent.click(screen.getByRole('button', { name: /Pause site/ }))
    expect(await screen.findByText('Wallet locked')).toBeInTheDocument()
  })

  it('turning autopay off asks first, and does nothing if declined', async () => {
    const f = mockFetch(true, site({ autopay: false, lineStatus: 'ending', endsAt: '2026-12-15T00:00:00Z' }))
    confirm.mockResolvedValueOnce(false)
    view(site())
    fireEvent.click(screen.getByRole('button', { name: /Turn off autopay/ }))
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(confirm.mock.calls[0][0].message).toContain('acme.jeffi.site stays online until 15 Dec 2026')
    expect(f).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: /Turn off autopay/ }))
    expect(await screen.findByText('Autopay is off')).toBeInTheDocument()
    expect(action(f)).toBe('renew_off')
    expect(await screen.findByText(/Autopay is off: the site goes offline on 15 Dec 2026/)).toBeInTheDocument()
  })

  it('an unapproved autopay shows an approve link', () => {
    view(site({ checkoutUrl: 'https://rzp.io/approve', autopay: false }))
    expect(screen.getByText('Waiting for your approval')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Approve autopay' })).toHaveAttribute('href', 'https://rzp.io/approve')
  })

  it('a wallet-paid site links to the subscription move', () => {
    view(site({ lineStatus: 'legacy_wallet', graceUntil: '2026-12-31T00:00:00Z' }))
    expect(screen.getByText(/Hosting is still paid from your wallet. Move it to your subscription by 31 Dec 2026/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Move to subscription' })).toHaveAttribute('href', '/dashboard/billing/subscribe?tenant=acme%20ws')
  })

  it('a lapsed trial shows KeepOnline, and Keep puts the site on the subscription', async () => {
    const f = mockFetch(true, site())
    view(site({ status: 'paused', pauseReason: 'unpaid', lineStatus: 'trial', lapsed: true, autopay: false, free: false }), [{ slug: 'basic', name: 'Basic', priceInr: 999 }])
    expect(screen.getByText('Your free trial has ended')).toBeInTheDocument()
    expect(screen.getByText('Offline · unpaid')).toBeInTheDocument()
    expect(screen.getByText(/Offline because its hosting is unpaid/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Go live again/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Basic/ })).toHaveAttribute('href', '/onboard?mode=add-store&plan=basic')
    fireEvent.click(screen.getByRole('button', { name: /Keep Showcase/ }))
    expect(await screen.findByText('Your site is on your subscription')).toBeInTheDocument()
    expect(action(f)).toBe('resume')
  })
})

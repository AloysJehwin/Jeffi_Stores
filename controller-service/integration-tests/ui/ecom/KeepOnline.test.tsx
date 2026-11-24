import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import KeepOnline, { storeOnboardHref } from '@controller/components/ecom/KeepOnline'

const site = (over: Record<string, unknown> = {}) =>
  ({
    host: 'acme.jeffi.site',
    status: 'paused',
    lineStatus: 'trial',
    lapsed: true,
    autopay: false,
    free: false,
    priceInr: 200,
    subscriptionStatus: null,
    checkoutUrl: null,
    graceUntil: null,
    ...over,
  }) as any
const plans = [
  { slug: 'basic', name: 'Basic', priceInr: 999 },
  { slug: 'pro', name: 'Pro', priceInr: 2999 },
]

describe('KeepOnline', () => {
  it('after a trial, offers Keep Showcase at the monthly price and calls onKeep', () => {
    const onKeep = vi.fn<(...a: any[]) => any>()
    render(<KeepOnline site={site()} plans={null} tenantSlug="acme" onKeep={onKeep} busy={false} />)
    expect(screen.getByText('Your free trial has ended')).toBeInTheDocument()
    expect(screen.getByText(/acme.jeffi.site is offline/)).toBeInTheDocument()
    expect(screen.getByText('₹200/month')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Keep Showcase · ₹200\/month/ }))
    expect(onKeep).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Upgrade to an online store')).toBeNull()
  })

  it('disables Keep while busy', () => {
    render(<KeepOnline site={site()} plans={null} tenantSlug="acme" onKeep={() => {}} busy />)
    expect(screen.getByRole('button', { name: /Keep Showcase/ })).toBeDisabled()
  })

  it('lists store plans with prices linking to the store application', () => {
    render(<KeepOnline site={site()} plans={plans} tenantSlug="acme" onKeep={() => {}} busy={false} />)
    expect(screen.getByText('Upgrade to an online store')).toBeInTheDocument()
    const pro = screen.getByRole('link', { name: /Pro/ })
    expect(pro).toHaveAttribute('href', '/onboard?mode=add-store&plan=pro')
    expect(pro).toHaveTextContent('₹2,999/month')
    expect(storeOnboardHref('a b')).toBe('/onboard?mode=add-store&plan=a%20b')
  })

  it('after a failed payment sends the owner to Billing instead of a Keep button', () => {
    render(
      <KeepOnline
        site={site({ status: 'published', lineStatus: 'active', lapsed: false, subscriptionStatus: 'halted', graceUntil: '2026-12-05T00:00:00Z' })}
        plans={null}
        tenantSlug="acme store"
        onKeep={() => {}}
        busy={false}
      />,
    )
    expect(screen.getByText('Your last payment didn’t go through')).toBeInTheDocument()
    expect(screen.getByText(/it goes offline on 5 Dec 2026/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pay on Billing' })).toHaveAttribute('href', '/dashboard/billing?tenant=acme%20store')
    expect(screen.queryByRole('button', { name: /Keep Showcase/ })).toBeNull()
  })

  it('warns of lapsing hosting while the site is still online', () => {
    render(<KeepOnline site={site({ status: 'published', lineStatus: 'active' })} plans={null} tenantSlug="acme" onKeep={() => {}} busy={false} />)
    expect(screen.getByText('Hosting for this site has lapsed')).toBeInTheDocument()
    expect(screen.getByText(/goes offline soon unless it is paid/)).toBeInTheDocument()
  })
})

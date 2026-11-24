import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import type { ShowcaseConsoleState } from '@controller/lib/showcase/state'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))

import SitesList from '@controller/app/(ecom)/ecom/dashboard/showcase/SitesList'

const site = (o: Partial<ShowcaseConsoleState>): ShowcaseConsoleState => ({
  id: 'a1', slug: 'acme', name: 'Acme', status: 'live', pauseReason: null, host: 'site-acme.jeffistores.in', url: 'https://site-acme.jeffistores.in', previewUrl: 'https://site-acme.jeffistores.in?jeffi_preview=1',
  hasPage: true, publishedAt: '2026-11-01T00:00:00Z', paidUntil: '2026-12-01T00:00:00Z', renew: true, lastChargeError: null, balanceInr: null,
  unreadLeads: 0, priceInr: 200, free: true, lapsed: false, due: false, pausesOn: null,
  trialEndsAt: '2026-11-08T00:00:00Z', lineStatus: 'trial', onSubscription: false, subscriptionStatus: null, ...o,
})

const hrefs = (li: HTMLElement) => within(li).getAllByRole('link').map(a => a.getAttribute('href'))

describe('SitesList', () => {
  it('shows one row for a single live site, with its per-site links', () => {
    render(<SitesList sites={[site({ unreadLeads: 2 })]} tenantSlug="ecom" />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Free until 1 Dec 2026')).toBeTruthy()
    expect(within(rows[0]).getByText('2 new')).toBeTruthy()
    expect(within(rows[0]).getByRole('link', { name: /site-acme\.jeffistores\.in/ }).getAttribute('href')).toBe('https://site-acme.jeffistores.in?jeffi_preview=1')
    expect(hrefs(rows[0])).toEqual(
      expect.arrayContaining([
        '/dashboard/showcase/a1/edit?tenant=ecom',
        '/dashboard/showcase/a1/leads?tenant=ecom',
        '/dashboard/showcase/a1/analytics?tenant=ecom',
        '/dashboard/showcase/a1/domain?tenant=ecom',
        '/dashboard/showcase/a1?tenant=ecom',
      ]),
    )
  })

  it('lists two sites; a draft continues in the builder, a paused one says why', () => {
    render(
      <SitesList
        sites={[site({ id: 'b2', name: 'Beta', status: 'draft', paidUntil: null, publishedAt: null, free: false }), site({ status: 'paused', pauseReason: 'unpaid' })]}
        tenantSlug="ecom"
      />,
    )
    const [draft, paused] = screen.getAllByRole('listitem')
    expect(within(draft).getByText('Draft')).toBeTruthy()
    expect(within(draft).getByRole('link', { name: /Continue setting up/ }).getAttribute('href')).toBe('/onboard/showcase?site=b2')
    expect(hrefs(draft)).not.toContain('/dashboard/showcase/b2/edit?tenant=ecom')
    expect(within(paused).getByText('Paused · unpaid')).toBeTruthy()
    expect(within(paused).getByRole('link', { name: /Edit/ }).getAttribute('href')).toBe('/dashboard/showcase/a1/edit?tenant=ecom')
  })
})

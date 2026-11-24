import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/app/(ecom)/ecom/dashboard/DomainPurchase', () => ({ default: (p: any) => <div data-testid="purchase">{p.tenantId}|{p.tenantSlug}|{p.siteId}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/CustomDomains', () => ({ default: (p: any) => <div data-testid="custom">{p.tenantId}|{p.slug}|{p.maxDomains}|{p.siteId}</div> }))

import { SHOWCASE_HOST_PREFIX } from '@/lib/showcase/types'
import DomainClient from '@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/domain/DomainClient'

const view = (over: Record<string, unknown> = {}) =>
  render(
    <DomainClient siteId="s1" slug="acme" name="Acme Studio" host="acme.jeffi.site" customDomain={null} status="live" workspace={{ id: 't1', slug: 'acme-ws' }} tenantSlug="acme ws" {...(over as any)} />,
  )

describe('Showcase DomainClient', () => {
  it('shows the free address, links back to the sites list and offers buying or connecting a domain', () => {
    view()
    expect(screen.getByText('Acme Studio')).toBeInTheDocument()
    expect(screen.getByText(/Give acme.jeffi.site a domain of its own/)).toBeInTheDocument()
    expect(screen.getByText('Your site is at')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /acme.jeffi.site/ })).toHaveAttribute('href', 'https://acme.jeffi.site')
    expect(screen.getByRole('link', { name: /Sites/ })).toHaveAttribute('href', '/dashboard/showcase?tenant=acme%20ws')
    expect(screen.getByTestId('purchase')).toHaveTextContent('t1|acme-ws|s1')
    expect(screen.getByTestId('custom')).toHaveTextContent(`t1|${SHOWCASE_HOST_PREFIX}acme|1|s1`)
  })

  it('shows the live custom domain and the original address as still reachable', () => {
    view({ customDomain: 'www.acme.in' })
    expect(screen.getByText('Live on')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /www.acme.in/ })).toHaveAttribute('href', 'https://www.acme.in')
    expect(screen.getByText('Still reachable at')).toBeInTheDocument()
  })

  it('warns that a draft site is not published yet', () => {
    view({ status: 'draft' })
    expect(screen.getByText(/This site is not published yet/)).toBeInTheDocument()
  })

  it('warns that a paused site shows offline', () => {
    view({ status: 'paused' })
    expect(screen.getByText(/This site is paused/)).toBeInTheDocument()
  })

  it('has no warning for a live site', () => {
    view()
    expect(screen.queryByText(/not published yet|is paused/)).toBeNull()
  })

  it('without a workspace asks to publish first instead of offering domains', () => {
    view({ workspace: null })
    expect(screen.getByText(/Publish the site first/)).toBeInTheDocument()
    expect(screen.queryByTestId('purchase')).toBeNull()
    expect(screen.queryByTestId('custom')).toBeNull()
  })
})

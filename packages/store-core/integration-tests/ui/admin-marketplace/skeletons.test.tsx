import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  MARKETPLACE_INFO,
  MARKETPLACE_TABS,
  ADS_TITLE,
  ADS_TABS,
  IMPORT_HISTORY_COLUMNS,
  MarketplaceOverviewLoading,
  InventoryLoading,
  SettlementsLoading,
  MarketplaceTabLoading,
  MarketplaceLoadingPage,
  MarketplaceAdsLoadingPage,
} from '@/components/admin/marketplace/skeletons'

// Loading shapes for the marketplace + ads consoles. Server-safe: each loading.tsx composes these
// with its real labels so the page appears instantly. Tests assert the real text each shape carries.

describe('marketplace skeleton constants', () => {
  it('names each channel with a title and description', () => {
    expect(MARKETPLACE_INFO.myntra.title).toBe('Myntra')
    expect(MARKETPLACE_INFO.ajio.title).toBe('AJIO')
    expect(MARKETPLACE_INFO.flipkart.description).toContain('Flipkart')
  })

  it('lists the console tabs in order', () => {
    expect(MARKETPLACE_TABS[0]).toEqual({ id: 'overview', label: 'Overview' })
    expect(MARKETPLACE_TABS.map(t => t.id)).toContain('settlements')
  })

  it('names the ads consoles and tabs', () => {
    expect(ADS_TITLE.myntra_ads).toBe('Myntra Ads')
    expect(ADS_TABS).toContain('Campaigns')
    expect(IMPORT_HISTORY_COLUMNS).toContain('Spend')
  })
})

describe('MarketplaceOverviewLoading (render)', () => {
  it('renders the KPI labels and the section title', () => {
    render(<MarketplaceOverviewLoading />)
    expect(screen.getByText('Orders today')).toBeInTheDocument()
    expect(screen.getByText('Breaching SLA')).toBeInTheDocument()
    expect(screen.getByText('Recent pushes')).toBeInTheDocument()
  })
})

describe('InventoryLoading (render)', () => {
  it('renders its KPIs and section titles', () => {
    render(<InventoryLoading />)
    expect(screen.getByText('Listings with stock')).toBeInTheDocument()
    expect(screen.getByText('Stock on the marketplace')).toBeInTheDocument()
    expect(screen.getByText('Safety buffer')).toBeInTheDocument()
  })
})

describe('SettlementsLoading (render)', () => {
  it('renders both payout sections', () => {
    render(<SettlementsLoading />)
    expect(screen.getByText('Payouts')).toBeInTheDocument()
    expect(screen.getByText('Delivered, not settled')).toBeInTheDocument()
    expect(screen.getByText('Receivable')).toBeInTheDocument()
  })
})

describe('MarketplaceTabLoading (branches)', () => {
  it('renders the inventory shape for the inventory tab', () => {
    render(<MarketplaceTabLoading tab="inventory" />)
    expect(screen.getByText('Safety buffer')).toBeInTheDocument()
  })

  it('renders the settlements shape for the settlements tab', () => {
    render(<MarketplaceTabLoading tab="settlements" />)
    expect(screen.getByText('Payouts')).toBeInTheDocument()
  })

  it('renders the overview + connection for an unknown tab (default)', () => {
    render(<MarketplaceTabLoading tab="overview" />)
    // Default branch adds the Connection section beneath the overview.
    expect(screen.getByText('Connection')).toBeInTheDocument()
    expect(screen.getByText('Recent pushes')).toBeInTheDocument()
  })
})

describe('full loading pages (render)', () => {
  it('renders the marketplace page with the channel title', () => {
    render(<MarketplaceLoadingPage channel="myntra" />)
    expect(screen.getByText('Myntra')).toBeInTheDocument()
  })

  it('renders the ads page with the ads title', () => {
    render(<MarketplaceAdsLoadingPage channel="ajio_ads" />)
    expect(screen.getByText('AJIO Ads')).toBeInTheDocument()
  })
})

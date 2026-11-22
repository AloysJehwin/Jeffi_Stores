import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))

// Render each offer slide inline so we can assert content without the carousel engine.
vi.mock('@/components/visitor/slides/Slides', () => ({
  default: ({ children }: any) => <div data-testid="slides">{children}</div>,
}))

import RazorpayOffers from '@/components/visitor/RazorpayOffers'

const offer = (over: Record<string, any> = {}) => ({
  id: 'off_1',
  title: '10% off on HDFC cards',
  issuers: ['HDFC'],
  methods: ['card'],
  ...over,
})

function mockFetch(payload: any, ok = true) {
  global.fetch = vi.fn<(...a: any[]) => any>(() =>
    Promise.resolve({ ok, json: () => Promise.resolve(payload) })
  ) as any
}

describe('RazorpayOffers (render + fetch branches)', () => {
  beforeEach(() => {
    mockFetch({ offers: [] })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when there are no offers', async () => {
    mockFetch({ offers: [] })
    const { container } = render(<RazorpayOffers />)
    // Give the effect a tick; still empty.
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders the heading and the offer titles once offers load', async () => {
    mockFetch({ offers: [offer(), offer({ id: 'off_2', title: '5% off ICICI', issuers: ['ICICI'], methods: ['upi'] })] })
    render(<RazorpayOffers />)
    await screen.findByText('10% off on HDFC cards')
    expect(screen.getByText('Bank Offers via Razorpay')).toBeInTheDocument()
    expect(screen.getByText('5% off ICICI')).toBeInTheDocument()
  })

  it('renders the issuer/method subtitle with the method label mapped', async () => {
    mockFetch({ offers: [offer({ issuers: ['HDFC'], methods: ['netbanking'] })] })
    render(<RazorpayOffers />)
    // issuers + mapped method label joined by " · ".
    await screen.findByText('HDFC · Netbanking')
  })

  it('links each offer to the bank-offer T&C anchor', async () => {
    mockFetch({ offers: [offer()] })
    render(<RazorpayOffers />)
    const link = (await screen.findByText('10% off on HDFC cards')).closest('a')!
    expect(link).toHaveAttribute('href', '/legal/terms-and-conditions#5a-bank-offers-cashback')
  })

  it('stays empty when the request is not ok', async () => {
    mockFetch(null, false)
    const { container } = render(<RazorpayOffers />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })
})

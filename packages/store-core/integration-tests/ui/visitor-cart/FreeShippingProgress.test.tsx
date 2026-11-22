import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import FreeShippingProgress from '@/components/visitor/cart/FreeShippingProgress'

// FreeShippingProgress GETs /api/cart/free-delivery once, then draws a progress bar towards the threshold.
// Branch is driven by the mocked rule + the subtotal prop.

function mockRule(rule: { freeThreshold: number; weightLimitKg: number } | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(rule) } as Response))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FreeShippingProgress', () => {
  it('renders nothing while subtotal is zero', async () => {
    mockRule({ freeThreshold: 1000, weightLimitKg: 5 })
    const { container } = render(<FreeShippingProgress subtotal={0} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('shows the remaining amount and a partial progress bar when below the threshold', async () => {
    mockRule({ freeThreshold: 1000, weightLimitKg: 5 })
    render(<FreeShippingProgress subtotal={600} />)
    // ₹400 remaining.
    expect(await screen.findByText('₹400.00')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByText(/parcels under 5 kg/)).toBeInTheDocument()
  })

  it('shows the unlocked message and a full bar once the threshold is met', async () => {
    mockRule({ freeThreshold: 1000, weightLimitKg: 5 })
    render(<FreeShippingProgress subtotal={1200} />)
    expect(await screen.findByText('You have unlocked free delivery')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('renders nothing when there is no active rule', async () => {
    mockRule(null)
    const { container } = render(<FreeShippingProgress subtotal={600} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders nothing when the threshold is zero (disabled)', async () => {
    mockRule({ freeThreshold: 0, weightLimitKg: 5 })
    const { container } = render(<FreeShippingProgress subtotal={600} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

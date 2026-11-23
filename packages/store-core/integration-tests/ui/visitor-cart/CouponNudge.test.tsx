import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CouponNudge from '@/components/visitor/cart/CouponNudge'

// CouponNudge debounces (300ms) then GETs /api/coupons/nudge?subtotal=. We drive the branch by what the
// mocked fetch resolves; real timers + waitFor let the debounce elapse naturally.

function mockNudge(nudge: { code: string; saving: number; shortfall: number } | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ nudge }) } as Response))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CouponNudge', () => {
  it('renders nothing while subtotal is zero (no fetch)', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { container } = render(<CouponNudge subtotal={0} signedIn applying={false} onApply={() => {}} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('renders the shortfall copy when more spend is needed to unlock', async () => {
    mockNudge({ code: 'SAVE50', saving: 50, shortfall: 120 })
    render(<CouponNudge subtotal={300} signedIn applying={false} onApply={() => {}} />)
    expect(await screen.findByText('SAVE50')).toBeInTheDocument()
    expect(screen.getByText('₹120.00')).toBeInTheDocument()
    // No Apply action in the shortfall branch.
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
  })

  it('shows an Apply button when unlocked and signed in, and fires onApply with the code', async () => {
    const onApply = vi.fn<(...a: any[]) => any>()
    mockNudge({ code: 'FLAT10', saving: 10, shortfall: 0 })
    render(<CouponNudge subtotal={500} signedIn applying={false} onApply={onApply} />)
    const btn = await screen.findByRole('button', { name: 'Apply' })
    fireEvent.click(btn)
    expect(onApply).toHaveBeenCalledWith('FLAT10')
  })

  it('shows a login link instead of Apply when not signed in', async () => {
    mockNudge({ code: 'FLAT10', saving: 10, shortfall: 0 })
    render(<CouponNudge subtotal={500} signedIn={false} applying={false} onApply={() => {}} />)
    const link = await screen.findByRole('link', { name: 'Log in to apply' })
    expect(link).toHaveAttribute('href', '/login?redirect=/cart')
  })

  it('disables the Apply button and shows Applying… while applying', async () => {
    mockNudge({ code: 'FLAT10', saving: 10, shortfall: 0 })
    render(<CouponNudge subtotal={500} signedIn applying onApply={() => {}} />)
    const btn = await screen.findByRole('button', { name: 'Applying...' })
    expect(btn).toBeDisabled()
  })

  it('renders nothing when the endpoint returns no nudge', async () => {
    mockNudge(null)
    const { container } = render(<CouponNudge subtotal={500} signedIn applying={false} onApply={() => {}} />)
    // Let the debounce + fetch settle, then confirm still empty.
    await waitFor(() => expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0))
    expect(container).toBeEmptyDOMElement()
  })
})

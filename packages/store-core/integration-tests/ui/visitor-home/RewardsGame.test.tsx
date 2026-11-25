import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const ctx = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as any, isLoading: false },
  cart: { cartCount: 0 },
  toast: vi.fn(),
  reduced: false,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ctx.auth }))
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ctx.cart }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: ctx.toast }) }))
vi.mock('motion/react', async () => {
  const React = await import('react')
  const strip = (tag: string) => function Stripped({ children, className }: any) {
    return React.createElement(tag, { className }, children)
  }
  return {
    motion: { div: strip('div'), span: strip('span'), path: () => null },
    useMotionValue: (v: number) => ({ get: () => v, set: () => {} }),
    useReducedMotion: () => ctx.reduced,
    // The wheel "finishes" at once.
    animate: (_v: unknown, _to: unknown, o: any) => {
      setTimeout(() => o.onComplete?.(), 0)
      return { stop: () => {} }
    },
  }
})

import RewardsGame from '@/components/visitor/home/RewardsGame'

const prizes = [
  { id: 'p10', label: '10% off', kind: 'coupon' },
  { id: 'pnone', label: 'Try again', kind: 'none' },
]
const wheel = { gameKey: 'spin1', mode: 'wheel', playLimit: 'once', prizes } as any
const scratch = { ...wheel, mode: 'scratch' } as any

const coupon = (over: any = {}) => ({
  id: 'c1',
  code: 'WIN10',
  discountType: 'percentage',
  value: 10,
  minPurchase: 0,
  maxDiscount: null,
  validUntil: null,
  status: 'usable',
  ...over,
})
const wonPlay = (over: any = {}) => ({ prizeId: 'p10', prizeLabel: '10% off', playedAt: '2026-03-05T10:00:00Z', coupon: coupon(), ...over })
const lostPlay = { prizeId: 'pnone', prizeLabel: 'Try again', playedAt: '2026-03-05T10:00:00Z', coupon: null }

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const fetchMock = vi.fn()

function api({ state, play }: { state?: any; play?: any }) {
  fetchMock.mockImplementation(async (url: string, init?: any) => {
    if (init?.method === 'POST') return play ?? res(200, { ok: true, play: wonPlay(), repeated: false })
    return state ?? res(200, { canPlay: true, nextPlayAt: null, lastPlay: null })
  })
}

beforeEach(() => {
  ctx.auth = { user: { id: 'u1' }, isLoading: false }
  ctx.cart = { cartCount: 0 }
  ctx.reduced = false
  ctx.toast.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('RewardsGame', () => {
  it('asks a signed-out visitor to sign in and never calls the API', () => {
    ctx.auth = { user: null, isLoading: false }
    render(<RewardsGame game={wheel} />)
    expect(screen.getByText(/Sign in to play — any coupon you win/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?redirect=/')
    expect(screen.queryByRole('button', { name: 'Play now' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a skeleton while auth is loading and renders nothing when the game is gone', async () => {
    ctx.auth = { user: null, isLoading: true }
    const { container, unmount } = render(<RewardsGame game={wheel} />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    unmount()
    ctx.auth = { user: { id: 'u1' }, isLoading: false }
    api({ state: res(404) })
    const gone = render(<RewardsGame game={wheel} />)
    await waitFor(() => expect(gone.container).toBeEmptyDOMElement())
  })

  it('treats a 401 from the state call as signed out', async () => {
    api({ state: res(401) })
    render(<RewardsGame game={wheel} />)
    expect(await screen.findByText(/Sign in to play — any coupon you win/)).toBeInTheDocument()
  })

  it('plays the wheel and shows the won coupon with copy and shop links', async () => {
    api({})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    render(<RewardsGame game={wheel} eyebrow="Daily" title="Spin it" ctaLabel="Spin!" />)
    expect(screen.getByRole('img', { name: 'Prize wheel: 10% off, Try again' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Spin it' })).toBeInTheDocument()
    expect(screen.getByText('Play once. Win a coupon and it lands straight in your account.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Spin!' }))
    expect(screen.getByRole('button', { name: 'Playing…' })).toBeDisabled()
    expect(await screen.findByText('You won')).toBeInTheDocument()
    expect(screen.getByText('WIN10')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/rewards/game/spin1/play', { method: 'POST', credentials: 'include' })
    expect(screen.getByRole('link', { name: /Shop now/ })).toHaveAttribute('href', '/products')
    expect(screen.getByRole('link', { name: 'Your coupons' })).toHaveAttribute('href', '/account/rewards#coupons')
    expect(screen.getByText("You've played this one.")).toBeInTheDocument()
    expect(screen.getByText(/Add something to your cart/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(ctx.toast).toHaveBeenCalledWith('Coupon code copied', 'success'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('WIN10')
  })

  it('offers to apply the coupon in the cart when it has items, and reports a failed copy', async () => {
    ctx.cart = { cartCount: 2 }
    api({ state: res(200, { canPlay: false, nextPlayAt: null, lastPlay: wonPlay() }) })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    render(<RewardsGame game={wheel} />)
    expect(await screen.findByText('Your last play')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Apply in cart/ })).toHaveAttribute('href', expect.stringContaining('WIN10'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(ctx.toast).toHaveBeenCalledWith('Could not copy the code', 'error'))
  })

  it('explains a used or expired coupon and drops the copy button', async () => {
    api({ state: res(200, { canPlay: false, nextPlayAt: null, lastPlay: wonPlay({ coupon: coupon({ status: 'used' }) }) }) })
    const { unmount } = render(<RewardsGame game={wheel} />)
    expect(await screen.findByText('You have used this coupon.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    unmount()
    api({ state: res(200, { canPlay: false, nextPlayAt: null, lastPlay: wonPlay({ coupon: coupon({ status: 'expired' }) }) }) })
    render(<RewardsGame game={wheel} />)
    expect(await screen.findByText('This coupon has expired.')).toBeInTheDocument()
  })

  it('tells the visitor when they did not win', async () => {
    api({ state: res(200, { canPlay: false, nextPlayAt: null, lastPlay: lostPlay }) })
    render(<RewardsGame game={wheel} />)
    expect(await screen.findByText('No coupon this time — thanks for playing.')).toBeInTheDocument()
  })

  it('says when to come back for limited replays', async () => {
    api({ state: res(200, { canPlay: false, nextPlayAt: '2026-03-06T10:00:00Z', lastPlay: lostPlay }) })
    const { unmount } = render(<RewardsGame game={{ ...wheel, playLimit: 'daily' }} />)
    expect(await screen.findByText(/Come back after/)).toBeInTheDocument()
    unmount()
    api({ state: res(200, { canPlay: false, nextPlayAt: null, lastPlay: lostPlay }) })
    render(<RewardsGame game={{ ...wheel, playLimit: 'weekly' }} />)
    expect(await screen.findByText('Come back next week.')).toBeInTheDocument()
  })

  it('shows a repeated play as the last result without spinning', async () => {
    api({ play: res(200, { ok: true, play: wonPlay(), repeated: true }) })
    render(<RewardsGame game={wheel} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Play now' }))
    expect(await screen.findByText('Your last play')).toBeInTheDocument()
  })

  it('goes back to ready with an error toast when the play fails', async () => {
    api({ play: res(500) })
    render(<RewardsGame game={wheel} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Play now' }))
    await waitFor(() => expect(ctx.toast).toHaveBeenCalledWith('Could not play right now. Please try again.', 'error'))
    expect(await screen.findByRole('button', { name: 'Play now' })).toBeEnabled()
  })

  it('switches to signed-out or gone when the play call says 401 or 404', async () => {
    api({ play: res(401) })
    const { unmount } = render(<RewardsGame game={wheel} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Play now' }))
    expect(await screen.findByText(/Sign in to play — any coupon you win/)).toBeInTheDocument()
    unmount()
    api({ play: res(404) })
    const gone = render(<RewardsGame game={wheel} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Play now' }))
    await waitFor(() => expect(gone.container).toBeEmptyDOMElement())
  })

  it('renders a scratch card with its hint and a Reveal button under reduced motion', async () => {
    api({})
    const { unmount } = render(<RewardsGame game={scratch} />)
    expect(screen.getByRole('heading', { name: 'Scratch to win' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Scratch card' })).toBeInTheDocument()
    expect(await screen.findByText('or scratch the card with your finger')).toBeInTheDocument()
    expect(screen.getByText('Scratch to reveal')).toBeInTheDocument()
    unmount()

    ctx.reduced = true
    render(<RewardsGame game={scratch} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal' }))
    expect(await screen.findByText('You won', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Scratch card: 10% off' })).toBeInTheDocument()
  })
})

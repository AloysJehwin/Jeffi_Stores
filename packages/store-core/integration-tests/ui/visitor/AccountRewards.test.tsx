import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let auth: any = { user: { id: 'u1' }, isLoading: false }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/components/visitor/AccountMobileHeader', () => ({ default: () => <div /> }))
vi.mock('@/components/visitor/skeletons/account', () => ({ RewardsBodySkeleton: () => <div role="status">loading rewards</div> }))
let coupons: any[] | undefined = []
vi.mock('@/components/visitor/coupons/useAccountCoupons', () => ({ useAccountCoupons: () => ({ coupons }) }))
vi.mock('@/components/visitor/account/AccountCoupons', () => ({
  default: ({ coupons }: any) => <div data-testid="coupons">{`coupons:${coupons.length}`}</div>,
}))

import AccountRewards from '@/components/visitor/AccountRewards'

const fetchMock = vi.fn()
const program = {
  rupeesPerPoint: 100, pointValue: 1, minRedeemPoints: 100, creditDelayDays: 7,
  tiers: [
    { key: 'bronze', name: 'Bronze', minPoints: 0, multiplier: 1 },
    { key: 'silver', name: 'Silver', minPoints: 1000, multiplier: 1.5 },
  ],
}
const payload = (over: Record<string, any> = {}) => ({
  enabled: true,
  tier: { key: 'bronze', name: 'Bronze', multiplier: 1 },
  nextTier: { key: 'silver', name: 'Silver', minPoints: 1000, pointsToGo: 500 },
  points: 450,
  lifetimePoints: 500,
  pending: { points: 0, nextCreditAt: null },
  history: { items: [], total: 0, page: 1, pageSize: 20 },
  program,
  ...over,
})
const entry = (id: string, reason: string, delta: number, over: Record<string, any> = {}) => ({
  id, reason, delta, orderNumber: null, couponCode: null, createdAt: '2026-04-02T00:00:00Z', ...over,
})
const loyalty = (data: any, ok = true) => fetchMock.mockImplementation(async (url: string) => ({ ok, json: async () => (String(url).includes('redeem') ? { code: 'RDM1' } : data) }))

describe('AccountRewards', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    push.mockReset()
    showToast.mockReset()
    coupons = []
    auth = { user: { id: 'u1' }, isLoading: false }
    vi.stubGlobal('fetch', fetchMock)
  })

  it('redirects a signed-out visitor to login', async () => {
    auth = { user: null, isLoading: false }
    render(<AccountRewards />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?redirect=/account/rewards'))
  })

  it('shows the skeleton until the first page lands', async () => {
    loyalty(payload())
    render(<AccountRewards />)
    expect(screen.getByRole('status')).toHaveTextContent('loading rewards')
    expect(await screen.findByText('Bronze tier')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/user/loyalty?historyPage=1&couponPage=1')
  })

  it('draws the tier card: points, worth, next tier, multiplier and pending points', async () => {
    loyalty(payload({ tier: { key: 'silver', name: 'Silver', multiplier: 1.5 }, pending: { points: 40, nextCreditAt: '2026-05-01T00:00:00Z' } }))
    render(<AccountRewards />)
    expect(await screen.findByText('Silver tier')).toBeInTheDocument()
    expect(screen.getByText('1.5x points')).toBeInTheDocument()
    expect(screen.getByText('450')).toBeInTheDocument()
    expect(screen.getByText(/points available, worth ₹450/)).toBeInTheDocument()
    expect(screen.getByText('500 more points to reach Silver')).toBeInTheDocument()
    expect(screen.getByText(/40 points on the way, the next from 1 May 2026/)).toBeInTheDocument()
  })

  it('at the top tier there is nothing left to reach', async () => {
    loyalty(payload({ nextTier: null }))
    render(<AccountRewards />)
    expect(await screen.findByText('You are at the highest tier')).toBeInTheDocument()
  })

  it('explains the programme and its tier table', async () => {
    loyalty(payload())
    render(<AccountRewards />)
    await screen.findByText('Bronze tier')
    expect(screen.getByText(/Earn 1 point for every ₹100/)).toBeInTheDocument()
    expect(screen.getByText('Points are added 7 days after your order is delivered.')).toBeInTheDocument()
    expect(screen.getByText('1,000')).toBeInTheDocument()
    expect(screen.getByText('1.5x')).toBeInTheDocument()
  })

  it('lists history with a readable label and signed delta, or an empty state', async () => {
    loyalty(
      payload({
        history: {
          total: 6, page: 1, pageSize: 20,
          items: [
            entry('1', 'order_earn', 50, { orderNumber: 'A-1' }),
            entry('2', 'order_reversal', -50),
            entry('3', 'redeem', -100, { couponCode: 'C100' }),
            entry('4', 'redeem_refund', 100),
            entry('5', 'referral', 500),
            entry('6', 'manual', 5),
          ],
        },
      })
    )
    render(<AccountRewards />)
    expect(await screen.findByText('Points for order A-1')).toBeInTheDocument()
    expect(screen.getByText('Points taken back for an order')).toBeInTheDocument()
    expect(screen.getByText('Redeemed for coupon C100')).toBeInTheDocument()
    expect(screen.getByText('Points returned')).toBeInTheDocument()
    expect(screen.getByText('Reward for referring a friend')).toBeInTheDocument()
    expect(screen.getByText('Adjustment by the store')).toBeInTheDocument()
    expect(screen.getByText('+50')).toBeInTheDocument()
    expect(screen.getByText('-100')).toBeInTheDocument()
  })

  it('shows an empty history message when there are no entries', async () => {
    loyalty(payload())
    render(<AccountRewards />)
    expect(await screen.findByText(/No points yet/)).toBeInTheDocument()
  })

  it('redeem: validates the amount, posts, toasts and reloads', async () => {
    loyalty(payload())
    render(<AccountRewards />)
    const input = await screen.findByLabelText('Points to redeem')
    const button = screen.getByRole('button', { name: 'Get coupon' })
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: '9a9' } })
    expect(input).toHaveValue('99')
    expect(screen.getByText('Enter at least 100 points')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '9999' } })
    expect(screen.getByText('You do not have that many points')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '200' } })
    const go = screen.getByRole('button', { name: 'Get ₹200 coupon' })
    expect(go).toBeEnabled()
    fireEvent.click(go)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Coupon RDM1 is ready', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/user/loyalty/redeem')!
    expect(post[1].method).toBe('POST')
    expect(JSON.parse(post[1].body)).toEqual({ points: 200 })
    expect(input).toHaveValue('')
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/user/loyalty?')).length).toBeGreaterThan(1))
  })

  it('redeem: surfaces the server error', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('redeem') ? { ok: false, json: async () => ({ error: 'Not enough points' }) } : { ok: true, json: async () => payload() }
    )
    render(<AccountRewards />)
    fireEvent.change(await screen.findByLabelText('Points to redeem'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get ₹200 coupon' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not enough points', 'error'))
  })

  it('redeem: tells a user below the minimum how many points are missing', async () => {
    loyalty(payload({ points: 30 }))
    render(<AccountRewards />)
    expect(await screen.findByText('You need 70 more points to redeem.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Points to redeem')).not.toBeInTheDocument()
  })

  it('when the programme is off it still shows personal coupons, with an unavailable notice if there are none', async () => {
    loyalty(payload({ enabled: false }))
    const a = render(<AccountRewards />)
    expect(await screen.findByText('Rewards are not available for this account')).toBeInTheDocument()
    expect(screen.getByTestId('coupons')).toHaveTextContent('coupons:0')
    a.unmount()
    coupons = [{ id: 'c1' }]
    loyalty(payload({ enabled: false }))
    render(<AccountRewards />)
    expect(await screen.findByTestId('coupons')).toHaveTextContent('coupons:1')
    expect(screen.queryByText('Rewards are not available for this account')).not.toBeInTheDocument()
  })

  it('shows an error state when the request fails', async () => {
    loyalty({ error: 'down' }, false)
    render(<AccountRewards />)
    expect(await screen.findByText('Could not load your rewards')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to my account' })).toBeInTheDocument()
  })
})

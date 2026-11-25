import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let auth: any = { user: { id: 'u1' }, isLoading: false }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Halo' } }) }))
vi.mock('@/components/visitor/AccountMobileHeader', () => ({ default: () => <div data-testid="mobile-header" /> }))
vi.mock('@/components/visitor/skeletons/account', () => ({ ReferralsBodySkeleton: () => <div role="status">loading referrals</div> }))

import AccountReferrals from '@/components/visitor/AccountReferrals'

const fetchMock = vi.fn()
const payload = (over: Record<string, any> = {}) => ({
  enabled: true,
  code: 'ASHA10',
  program: { rewardPoints: 500, yearlyCap: 10, qualifyDays: 30 },
  counts: { joined: 1, rewarded: 2, reversed: 0, capped: 0, rejected: 1 },
  pointsEarned: 1000,
  rewardsLeftThisYear: 8,
  friends: { items: [], total: 0, page: 1, pageSize: 20 },
  ...over,
})
const friend = (id: string, over: Record<string, any> = {}) => ({
  id, name: `Friend ${id}`, status: 'joined', hasOrdered: false, points: null, signedUpAt: '2026-03-05T00:00:00Z', rewardedAt: null, ...over,
})
const reply = (data: any, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => data })

describe('AccountReferrals', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    push.mockReset()
    showToast.mockReset()
    auth = { user: { id: 'u1' }, isLoading: false }
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  })

  it('redirects a signed-out visitor to login', async () => {
    auth = { user: null, isLoading: false }
    render(<AccountReferrals />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?redirect=/account/referrals'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the skeleton while auth is loading and does not redirect', () => {
    auth = { user: null, isLoading: true }
    render(<AccountReferrals />)
    expect(screen.getByRole('status')).toHaveTextContent('loading referrals')
    expect(push).not.toHaveBeenCalled()
  })

  it('renders the share card, stats, how-it-works and the empty friends state', async () => {
    reply(payload())
    render(<AccountReferrals />)
    expect(await screen.findByRole('heading', { name: /Invite friends, earn 500 points each/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/user/referrals?page=1')
    expect(screen.getByText('ASHA10')).toBeInTheDocument()
    expect(screen.getByText('Friends joined').previousSibling).toHaveTextContent('3')
    expect(screen.getByText('Points earned').previousSibling).toHaveTextContent('1,000')
    expect(screen.getByText('Left this year').previousSibling).toHaveTextContent('8')
    expect(screen.getByText(/No one has joined with your link yet/)).toBeInTheDocument()
    expect(screen.getByText('You can earn up to 10 referral rewards a year.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See your points' })).toHaveAttribute('href', '/account/rewards')
  })

  it('builds the invite link from the origin and shares it on WhatsApp', async () => {
    reply(payload())
    render(<AccountReferrals />)
    await screen.findByText('ASHA10')
    const link = `${window.location.origin}/r/ASHA10`
    expect(screen.getByText(link)).toBeInTheDocument()
    const wa = screen.getByRole('link', { name: 'WhatsApp' })
    expect(wa.getAttribute('href')).toContain('https://wa.me/?text=')
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain(`I shop at Halo. Create your account with my link: ${link}`)
  })

  it('copies the link and toasts, or toasts an error when the clipboard fails', async () => {
    reply(payload())
    render(<AccountReferrals />)
    await screen.findByText('ASHA10')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Link copied', 'success'))
    expect((navigator.clipboard.writeText as any).mock.calls[0][0]).toContain('/r/ASHA10')
    ;(navigator.clipboard.writeText as any).mockRejectedValue(new Error('denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not copy the link', 'error'))
  })

  it('Share uses the native share sheet when there is one, else copies', async () => {
    reply(payload())
    render(<AccountReferrals />)
    await screen.findByText('ASHA10')
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Halo', url: expect.stringContaining('/r/ASHA10') })))
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Link copied', 'success'))
  })

  it('lists friends with a status chip per outcome', async () => {
    reply(
      payload({
        friends: {
          total: 5, page: 1, pageSize: 20,
          items: [
            friend('1'),
            friend('2', { hasOrdered: true }),
            friend('3', { status: 'rewarded', points: 500 }),
            friend('4', { status: 'reversed' }),
            friend('5', { status: 'rejected' }),
          ],
        },
      })
    )
    render(<AccountReferrals />)
    expect(await screen.findByText('Friend 1')).toBeInTheDocument()
    expect(screen.getByText('Joined')).toBeInTheDocument()
    expect(screen.getByText('Order placed')).toBeInTheDocument()
    expect(screen.getByText('Rewarded +500')).toBeInTheDocument()
    expect(screen.getByText('Order returned')).toBeInTheDocument()
    expect(screen.getByText('Not eligible')).toBeInTheDocument()
    expect(screen.getAllByText(/^Joined 5 Mar 2026$/)).toHaveLength(5)
  })

  it('shows "capped" friends as the yearly limit', async () => {
    reply(payload({ friends: { total: 1, page: 1, pageSize: 20, items: [friend('9', { status: 'capped' })] } }))
    render(<AccountReferrals />)
    expect(await screen.findByText('Yearly limit reached')).toBeInTheDocument()
  })

  it('says referrals are unavailable when the program is off or the user is not eligible', async () => {
    reply(payload({ enabled: false }))
    const a = render(<AccountReferrals />)
    expect(await screen.findByText('Referrals are not available for this account')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to my account' })).toHaveAttribute('href', '/account')
    a.unmount()
    reply(payload({ eligible: false }))
    render(<AccountReferrals />)
    expect(await screen.findByText('Referrals are not available for this account')).toBeInTheDocument()
  })

  it('shows an error state when the request fails', async () => {
    reply({ error: 'boom' }, false)
    render(<AccountReferrals />)
    expect(await screen.findByText('Could not load your referrals')).toBeInTheDocument()
  })
})

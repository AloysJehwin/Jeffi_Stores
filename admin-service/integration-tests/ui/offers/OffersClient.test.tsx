import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))

import OffersClient from '@admin/app/(admin)/admin/offers/OffersClient'

const future = new Date(Date.now() + 200 * 86_400_000).toISOString()
const soon = new Date(Date.now() + 5 * 86_400_000).toISOString()
const offers = [
  { id: 'offer_A', title: '10% off HDFC cards', methods: ['card', 'emi'], issuers: ['HDFC'], endsAt: future, terms: 'Min spend 5000', isVisible: true, titleOverride: null, displayOrder: 1, looksInternal: false },
  { id: 'offer_B', title: 'Raw internal text', methods: ['upi'], issuers: [], endsAt: soon, terms: null, isVisible: false, titleOverride: 'UPI cashback', displayOrder: 2, looksInternal: true },
]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('OffersClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'PATCH' ? json(true, {}) : json(true, { offers })))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists account offers with counts, methods, edited and internal flags', async () => {
    render(asAdmin(<OffersClient canWrite />))
    expect(await screen.findByText('10% off HDFC cards')).toBeInTheDocument()
    expect(screen.getByText('2 active on the account · 1 shown on the storefront')).toBeInTheDocument()
    expect(screen.getByText('Card · EMI')).toBeInTheDocument()
    expect(screen.getByText('UPI cashback')).toBeInTheDocument()
    expect(screen.getByText('edited')).toBeInTheDocument()
    expect(screen.getByText('looks internal')).toBeInTheDocument()
    expect(screen.getByText('Razorpay: Raw internal text')).toBeInTheDocument()
    expect(screen.getByText('Terms from Razorpay')).toBeInTheDocument()
    expect(screen.getByText(/· 4d|· 5d/)).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    fetchMock.mockResolvedValue(json(true, { offers: [] }))
    render(asAdmin(<OffersClient canWrite />))
    expect(await screen.findByText('No active offers on this Razorpay account.')).toBeInTheDocument()
  })

  it('explains a Razorpay problem such as test keys', async () => {
    fetchMock.mockResolvedValue(json(true, { offers: [], problem: { reason: 'test_mode', detail: 'Switch to live keys.' } }))
    render(asAdmin(<OffersClient canWrite />))
    expect(await screen.findByText('Offers cannot be listed on test keys')).toBeInTheDocument()
    expect(screen.getByText('Switch to live keys.')).toBeInTheDocument()
    expect(screen.queryByText('No active offers on this Razorpay account.')).not.toBeInTheDocument()
  })

  it('toasts when loading fails', async () => {
    fetchMock.mockResolvedValue(json(false))
    render(asAdmin(<OffersClient canWrite />))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not load offers from Razorpay', 'error'))
  })

  it('the visibility toggle PATCHes isVisible and reloads', async () => {
    render(asAdmin(<OffersClient canWrite />))
    await screen.findByText('10% off HDFC cards')
    fireEvent.click(screen.getAllByRole('switch')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Offer updated', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({ offerId: 'offer_A', isVisible: false })
  })

  it('overrides the wording and saves it', async () => {
    render(asAdmin(<OffersClient canWrite />))
    await screen.findByText('10% off HDFC cards')
    fireEvent.click(screen.getByRole('button', { name: 'Override wording' }))
    const input = screen.getByPlaceholderText('10% off HDFC cards')
    fireEvent.change(input, { target: { value: 'Save 10% with HDFC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({ offerId: 'offer_A', titleOverride: 'Save 10% with HDFC' })
  })

  it('cancel leaves the wording untouched; reset clears the override', async () => {
    render(asAdmin(<OffersClient canWrite />))
    await screen.findByText('10% off HDFC cards')
    fireEvent.click(screen.getByRole('button', { name: 'Override wording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Razorpay wording' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ offerId: 'offer_B', titleOverride: null })
  })

  it('changing the display order on blur PATCHes only when it changed', async () => {
    render(asAdmin(<OffersClient canWrite />))
    await screen.findByText('10% off HDFC cards')
    const [first] = screen.getAllByRole('spinbutton')
    fireEvent.blur(first, { target: { value: '1' } })
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
    fireEvent.blur(first, { target: { value: '7' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ offerId: 'offer_A', displayOrder: 7 })
  })

  it('toasts the server error on a failed update', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'PATCH' ? json(false, { error: 'Nope' }) : json(true, { offers })))
    render(asAdmin(<OffersClient canWrite />))
    await screen.findByText('10% off HDFC cards')
    fireEvent.click(screen.getAllByRole('switch')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nope', 'error'))
  })

  it('is read-only without write access', async () => {
    render(asMember(<OffersClient canWrite />, ['coupons:read']))
    await screen.findByText('10% off HDFC cards')
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Override wording' })).not.toBeInTheDocument()
  })
})

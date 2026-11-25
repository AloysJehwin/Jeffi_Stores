import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const replace = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/admin/reviews',
  useSearchParams: () => sp,
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: ({ src }: any) => <img src={src} alt="" /> }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: () => <div>filters</div> }))
vi.mock('@admin/app/(admin)/admin/reviews/_components/ReviewsOverview', () => ({ default: () => <div>reviews-overview</div> }))

import ReviewsClient from '@admin/app/(admin)/admin/reviews/ReviewsClient'

const review = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  rating: 4,
  title: 'Solid drill',
  comment: 'Works great for the price.',
  is_verified_purchase: true,
  is_approved: false,
  image_urls: ['https://cdn.test/a.jpg'],
  image_thumbnail_urls: ['https://cdn.test/a-t.jpg'],
  created_at: '2026-03-01T10:00:00Z',
  users: { first_name: 'Asha', last_name: 'Rao', email: 'asha@x.test' },
  products: { name: 'Power Drill', slug: 'power-drill' },
  ...over,
})
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('ReviewsClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams('tab=list')
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    confirm.mockResolvedValue(true)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_u: string, init?: any) =>
      init?.method === 'PATCH' ? json(true) : json(true, { reviews: [review(), review({ id: 'r2', is_approved: true, title: null, comment: 'x'.repeat(200), image_urls: [] })], total: 2 })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  it('opens on the overview and switches to the list with the pending preset', () => {
    sp = new URLSearchParams()
    render(asAdmin(<ReviewsClient canWrite />))
    expect(screen.getByText('reviews-overview')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain('tab=list')
    expect(replace.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('migrates an old ?view= link to ?tab=', () => {
    sp = new URLSearchParams('view=reviews')
    render(asAdmin(<ReviewsClient canWrite />))
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('tab=list'), { scroll: false })
  })

  it('lists reviews with author, stars, badges and product link', async () => {
    render(asAdmin(<ReviewsClient canWrite />))
    expect((await screen.findAllByText('Asha Rao')).length).toBeGreaterThan(0)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/reviews?')
    expect(String(fetchMock.mock.calls[0][0])).toContain('filter=all')
    expect(screen.getByText('Solid drill')).toBeInTheDocument()
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0)
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Power Drill' })[0]).toHaveAttribute('href', '/products/power-drill')
  })

  it('shows the empty state', async () => {
    fetchMock.mockResolvedValue(json(true, { reviews: [], total: 0 }))
    render(asAdmin(<ReviewsClient canWrite />))
    expect(await screen.findByText('No reviews found')).toBeInTheDocument()
    expect(screen.getByText('No reviews match your filters.')).toBeInTheDocument()
  })

  it('approves a pending review', async () => {
    render(asAdmin(<ReviewsClient canWrite />))
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Review approved', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({ reviewId: 'r1', action: 'approve' })
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
  })

  it('toasts when approval fails', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'PATCH' ? json(false) : json(true, { reviews: [review()], total: 1 })))
    render(asAdmin(<ReviewsClient canWrite />))
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to approve review', 'error'))
  })

  it('deletes after confirming, and keeps the review when declined', async () => {
    confirm.mockResolvedValueOnce(false)
    render(asAdmin(<ReviewsClient canWrite />))
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Review deleted', 'success'))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ reviewId: 'r1', action: 'reject' })
    expect(screen.queryByText('Solid drill')).not.toBeInTheDocument()
  })

  it('hides moderation without write access', async () => {
    render(asMember(<ReviewsClient canWrite />, ['reviews:read']))
    await screen.findAllByText('Asha Rao')
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })

  it('expands a long comment and opens a photo in the lightbox', async () => {
    render(asAdmin(<ReviewsClient canWrite />))
    await screen.findAllByText('Asha Rao')
    fireEvent.click(screen.getByRole('button', { name: 'Read more' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
    fireEvent.click(document.querySelector('img[src="https://cdn.test/a-t.jpg"]')!.closest('button')!)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

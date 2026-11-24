import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/admin/offers',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('@/components/admin/AdminImage', () => ({ default: ({ src }: any) => <img src={src} alt="" /> }))
vi.mock('@/components/admin/RowActions', () => ({
  default: ({ actions }: any) => (
    <div>
      {actions.filter((a: any) => !a.hidden).map((a: any) => (
        <button key={a.key} onClick={() => a.onSelect()}>{a.label}</button>
      ))}
    </div>
  ),
}))

import OffersListClient from '@admin/app/(admin)/admin/offers/OffersListClient'

const offers = [
  { id: 'o1', slug: 'diwali', title: 'Diwali Sale', image_url: 'https://cdn.test/d.png', blurhash: null, is_active: true, product_count: 12 },
  { id: 'o2', slug: 'summer', title: '', image_url: null, blurhash: null, is_active: false, product_count: 1 },
]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('OffersListClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(json(true, { offers }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads offers and lists title, link, product count and status', async () => {
    render(asAdmin(<OffersListClient canWrite />))
    expect(await screen.findByText('Diwali Sale')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/product-offers', { credentials: 'include' })
    expect(screen.getAllByText('/products?offer=diwali').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Untitled offer').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0)
  })

  it('shows the empty state when there are no offers', async () => {
    fetchMock.mockResolvedValue(json(true, { offers: [] }))
    render(asAdmin(<OffersListClient canWrite />))
    expect(await screen.findByText('No offers yet.')).toBeInTheDocument()
  })

  it('toasts when the load fails', async () => {
    fetchMock.mockResolvedValue(json(false))
    render(asAdmin(<OffersListClient canWrite />))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not load offers', 'error'))
  })

  it('Add offer creates one and opens its view page', async () => {
    render(asAdmin(<OffersListClient canWrite />))
    await screen.findByText('Diwali Sale')
    fetchMock.mockResolvedValueOnce(json(true, { offer: { id: 'new1' } }))
    fireEvent.click(screen.getByRole('button', { name: /Add offer/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/offers/new1/view')))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(url).toBe('/api/admin/product-offers')
    expect(JSON.parse(init.body)).toEqual({ title: 'New offer' })
  })

  it('toasts the API error when adding fails', async () => {
    render(asAdmin(<OffersListClient canWrite />))
    await screen.findByText('Diwali Sale')
    fetchMock.mockResolvedValueOnce(json(false, { error: 'Limit reached' }))
    fireEvent.click(screen.getByRole('button', { name: /Add offer/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Limit reached', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('deletes an offer and removes the row', async () => {
    render(asAdmin(<OffersListClient canWrite />))
    await screen.findByText('Diwali Sale')
    fetchMock.mockResolvedValueOnce(json(true))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete offer' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Offer deleted', 'success'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/product-offers/o1', { method: 'DELETE', credentials: 'include' })
    expect(screen.queryByText('Diwali Sale')).not.toBeInTheDocument()
  })

  it('hides Add and Delete without write access', async () => {
    render(asMember(<OffersListClient canWrite />, ['coupons:read']))
    await screen.findByText('Diwali Sale')
    expect(screen.queryByRole('button', { name: /Add offer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete offer' })).not.toBeInTheDocument()
  })

  it('hides write controls when the page says read-only even for an admin', async () => {
    render(asAdmin(<OffersListClient canWrite={false} />))
    await screen.findByText('Diwali Sale')
    expect(screen.queryByRole('button', { name: 'Delete offer' })).not.toBeInTheDocument()
  })
})

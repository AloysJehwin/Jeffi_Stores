import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/admin/offers/o1/edit',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({ value, onChange, disabled, placeholder }: any) => (
    <input aria-label={`date:${placeholder}`} data-testid="date" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/admin/OffersProductPicker', () => ({
  default: ({ offerId, draftId, canWrite }: any) => <div>picker:{offerId}:{String(draftId)}:{canWrite ? 'rw' : 'ro'}</div>,
}))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: ({ kind }: any) => <div>changelog:{kind}</div> }))
vi.mock('@/components/admin/drafts/MergeDialog', () => ({
  default: ({ conflicts, publishPath, onDone }: any) => (
    <div>
      <p>merge:{conflicts.length}:{publishPath}</p>
      <button onClick={() => onDone()}>merge-done</button>
    </div>
  ),
}))
const lockState: any = {}
const markLocked = vi.fn()
const discard = vi.fn()
vi.mock('@/hooks/useDraftLock', async orig => ({ ...(await orig<any>()), useDraftLock: () => ({ ...lockState, markLocked, discard }) }))
const editSession: any = { status: 'open', cancel: vi.fn() }
let onCancelled: (() => void) | undefined
vi.mock('@/hooks/useEditSession', () => ({ useEditSession: (o: any) => { onCancelled = o.onCancelled; return editSession } }))

import OfferDetailClient from '@admin/app/(admin)/admin/offers/[id]/OfferDetailClient'

const offer: any = { id: 'o1', title: 'Diwali Sale', is_active: true, starts_at: null, ends_at: null, updated_at: '2026-01-01T00:00:00Z' }
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()
const props = { backHref: '/admin/offers', categoryOptions: [], brandOptions: [] }
const patches = () => fetchMock.mock.calls.filter(c => c[1]?.method === 'PATCH').map(c => JSON.parse(c[1].body))

describe('OfferDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(lockState, {
      lock: null, loaded: true, isMine: true, claimable: false, readOnly: false, closed: false, viewers: [], canTakeOver: false,
      canDiscard: true, busy: false, unsaved: null, setUnsaved: vi.fn(), release: vi.fn(), claim: vi.fn(), requestAccess: vi.fn(),
      handover: vi.fn(), takeover: vi.fn(), candidates: vi.fn(), refresh: vi.fn(),
    })
    editSession.status = 'open'
    editSession.cancel.mockResolvedValue(true)
    discard.mockResolvedValue(true)
    confirm.mockResolvedValue(true)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(json(true))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders the offer with status, draft badge, picker and the settings link', () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" draftTitle="Spring tweak" actions={<button>extra</button>} />, ['coupons:write']))
    expect(screen.getByText('Diwali Sale · Spring tweak')).toBeInTheDocument()
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('picker:o1:d1:rw')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Homepage/ })).toHaveAttribute('href', expect.stringContaining('/admin/settings/homepage'))
    expect(screen.getByText('changelog:offer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'extra' })).toBeInTheDocument()
  })

  it('is read-only without a draft: no footer, no write picker, pending-draft badge', () => {
    render(asAdmin(<OfferDetailClient offer={{ ...offer, is_active: false, title: '' }} {...props} draftCount={2} />))
    expect(screen.getByText('Untitled offer')).toBeInTheDocument()
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0)
    expect(screen.getByText('2 drafts')).toBeInTheDocument()
    expect(screen.getByText('picker:o1:null:ro')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
  })

  it('shows "Draft pending" for a single open draft', () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftCount={1} />))
    expect(screen.getByText('Draft pending')).toBeInTheDocument()
  })

  it('saves a changed title on blur with the draft query and lock headers', async () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    const input = screen.getByDisplayValue('Diwali Sale')
    fireEvent.change(input, { target: { value: '  Festive Sale ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(patches()).toEqual([{ title: 'Festive Sale' }]))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(url).toBe('/api/admin/product-offers/o1?draft=d1')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('reverts an emptied title and skips the request for an unchanged one', async () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    const input = screen.getByDisplayValue('Diwali Sale')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('Diwali Sale')
    fireEvent.blur(input)
    expect(patches()).toEqual([])
  })

  it('saves launch and end dates as ISO boundaries, and clearing sends null', async () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    const [launch, end] = screen.getAllByTestId('date')
    fireEvent.change(launch, { target: { value: '2026-11-01' } })
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].startsAt).toBe(new Date(2026, 10, 1).toISOString())
    fireEvent.change(end, { target: { value: '2026-11-30' } })
    await waitFor(() => expect(patches()).toHaveLength(2))
    expect(patches()[1].endsAt).toBe(new Date(2026, 10, 30, 23, 59, 59, 999).toISOString())
    fireEvent.change(launch, { target: { value: '' } })
    await waitFor(() => expect(patches()).toHaveLength(3))
    expect(patches()[2]).toEqual({ startsAt: null })
  })

  it('toggling active saves isActive and flips the label', async () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(patches()).toEqual([{ isActive: false }]))
    expect(screen.getByText('Hidden everywhere until reactivated.')).toBeInTheDocument()
  })

  it('toasts a failed save', async () => {
    fetchMock.mockResolvedValue(json(false, {}, 500))
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save', 'error'))
  })

  it('a 423 on save toasts the server message and marks the lock', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Taken over by Priya' }, 423))
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Taken over by Priya', 'error'))
    expect(markLocked).toHaveBeenCalledWith({ isActive: false })
  })

  it('Publish posts to the publish path and opens the view page', async () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Offer published', 'success'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/product-offers/o1/publish?draft=d1', expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/offers/o1/view'))
  })

  it('toasts the server error when publishing fails and stays put', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Offer has no products' }, 400))
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Offer has no products', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('a draft conflict opens the merge dialog, and finishing it publishes', async () => {
    fetchMock.mockResolvedValue(json(false, { code: 'DRAFT_CONFLICT', conflicts: [{ field: 'title' }] }, 409))
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('merge:1:/api/admin/product-offers/o1/publish?draft=d1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'merge-done' }))
    expect(showToast).toHaveBeenCalledWith('Offer published', 'success')
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/offers/o1/view'))
  })

  it('a 423 on publish marks the lock', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Locked' }, 423))
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(markLocked).toHaveBeenCalled())
  })

  it('Discard draft confirms then discards and opens the view page', async () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(discard).toHaveBeenCalled())
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this draft?', variant: 'danger' }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/offers/o1/view'))
  })

  it('declining the discard confirmation keeps the draft', async () => {
    confirm.mockResolvedValue(false)
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(discard).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('Cancel confirms, cancels the session, and the onCancelled hook returns to the list', async () => {
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes?' }))
    await waitFor(() => expect(editSession.cancel).toHaveBeenCalled())
    onCancelled!()
    expect(push).toHaveBeenCalledWith('/admin/offers')
  })

  it('disables Publish while the edit session is closing', () => {
    editSession.status = 'closing'
    render(asAdmin(<OfferDetailClient offer={offer} {...props} draftId="d1" />))
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })

  it('hides the footer and disables the title without coupons write access', () => {
    render(asMember(<OfferDetailClient offer={offer} {...props} draftId="d1" />, ['coupons:read']))
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Diwali Sale')).toBeDisabled()
    expect(screen.getByText('picker:o1:d1:ro')).toBeInTheDocument()
  })
})

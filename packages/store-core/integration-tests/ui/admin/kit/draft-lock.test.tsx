import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import {
  ViewerAvatars, DraftLockBadge, ViewDraftLink, LockedFieldset, HandoverDialog, TakeoverDialog, DraftLockBanner,
} from '@/components/admin/kit/draft-lock'

const now = new Date().toISOString()
const view = (o: any = {}) => ({
  resourceType: 'product', resourceId: '1', ownerId: 'a1', ownerName: 'Priya', ownerActive: true, ownerCanEdit: true,
  via: 'start', reason: null, epoch: 1, startedAt: now, acquiredAt: now, lastActiveAt: now, updatedAt: now,
  closedAt: null, closedReason: null, closedById: null, closedByName: null, ...o,
})
function mkLock(o: any = {}): any {
  return {
    lock: view(), loaded: true, isMine: false, claimable: false, readOnly: true, closed: false, viewers: [], epoch: 1,
    canTakeOver: false, canDiscard: false, busy: false, unsaved: null, setUnsaved: vi.fn(),
    refresh: vi.fn(), markLocked: vi.fn(),
    claim: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(true),
    handover: vi.fn().mockResolvedValue(true), takeover: vi.fn().mockResolvedValue(true),
    requestAccess: vi.fn().mockResolvedValue(true), discard: vi.fn().mockResolvedValue(true),
    candidates: vi.fn().mockResolvedValue([]), ...o,
  }
}

beforeEach(() => {
  canWrite = true
})

describe('small pieces', () => {
  it('ViewerAvatars shows initials, a +N overflow and nothing when empty', () => {
    const { container, rerender } = render(<ViewerAvatars viewers={[]} />)
    expect(container).toBeEmptyDOMElement()
    const viewers = ['Priya Shah', 'Ravi', 'Meera K', 'Anil', 'Zoya'].map((n, i) => ({ adminId: `a${i}`, name: n, mode: i ? 'view' : 'edit', seenAt: now }))
    rerender(<ViewerAvatars viewers={viewers as any} />)
    expect(screen.getByText('PS')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.queryByText('Z')).toBeNull()
    expect(screen.getByText('PS').closest('span[title]')).toHaveAttribute('title', expect.stringContaining('Priya Shah (editing)'))
  })

  it('DraftLockBadge shows the owner, "You" for mine, and nothing with no owner', () => {
    const { container, rerender } = render(<DraftLockBadge lock={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<DraftLockBadge lock={{ ownerId: 'a', ownerName: 'Priya', lastActiveAt: now }} />)
    expect(screen.getByText('Priya')).toBeInTheDocument()
    rerender(<DraftLockBadge mine lock={{ ownerId: 'a', ownerName: 'Priya', lastActiveAt: now }} />)
    expect(screen.getByText('You')).toBeInTheDocument()
    rerender(<DraftLockBadge lock={{ ownerId: 'a', ownerName: null, lastActiveAt: now }} />)
    expect(screen.getByText('Another admin')).toBeInTheDocument()
  })

  it('ViewDraftLink links to the read-only editor', () => {
    render(<ViewDraftLink held={{ ownerName: 'Priya', href: '/admin/products/1/edit' }} />)
    expect(screen.getByRole('link', { name: /View draft \(read-only\) · Priya/ })).toHaveAttribute('href', '/admin/products/1/edit')
  })

  it('LockedFieldset disables the controls inside when read-only', () => {
    const { rerender } = render(<LockedFieldset readOnly><input aria-label="f" /></LockedFieldset>)
    expect(screen.getByLabelText('f')).toBeDisabled()
    rerender(<LockedFieldset readOnly={false}><input aria-label="f" /></LockedFieldset>)
    expect(screen.getByLabelText('f')).toBeEnabled()
  })
})

describe('DraftLockBanner', () => {
  it('renders nothing before the lock loads', () => {
    const { container } = render(<DraftLockBanner lock={mkLock({ loaded: false })} scope="products" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('my lock: shows Hand over and Release, and Release calls the lock', () => {
    const lock = mkLock({ isMine: true, readOnly: false })
    render(<DraftLockBanner lock={lock} scope="products" />)
    expect(screen.getByText('You are editing this draft')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(lock.release).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Hand over' })).toBeInTheDocument()
  })

  it('someone else holds it: read-only text with Request access, and Take over when allowed', () => {
    const lock = mkLock({ canTakeOver: true, lock: view({ via: 'takeover', reason: 'urgent fix' }) })
    render(<DraftLockBanner lock={lock} scope="products" />)
    expect(screen.getByText('Read-only.')).toBeInTheDocument()
    expect(screen.getByText(/taken over: urgent fix/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
    expect(lock.requestAccess).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Take over' })).toBeInTheDocument()
  })

  it('without write scope no action buttons show', () => {
    canWrite = false
    render(<DraftLockBanner lock={mkLock({ canTakeOver: true })} scope="products" />)
    expect(screen.getByText('Read-only.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('claimable draft offers Edit, with wording for an unclaimed or an ineligible owner', () => {
    const claimable = mkLock({ claimable: true, lock: view({ ownerId: null }) })
    const { rerender } = render(<DraftLockBanner lock={claimable} scope="products" />)
    expect(screen.getByText('No one is editing this draft.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(claimable.claim).toHaveBeenCalledTimes(1)
    rerender(<DraftLockBanner lock={mkLock({ claimable: true })} scope="products" />)
    expect(screen.getByText('Priya can no longer edit this draft.')).toBeInTheDocument()
  })

  it('a closed draft shows the closing summary', () => {
    render(<DraftLockBanner lock={mkLock({ closed: true, lock: view({ closedAt: now, closedReason: 'Published', closedByName: 'Ravi' }) })} scope="products" />)
    expect(screen.getByText(/Published by Ravi/)).toBeInTheDocument()
  })

  it('offers to copy unsaved changes to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const lock = mkLock({ unsaved: '{"a":1}' })
    render(<DraftLockBanner lock={lock} scope="products" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy them' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"a":1}'))
    await waitFor(() => expect(lock.setUnsaved).toHaveBeenCalledWith(null))
  })

  it('opens the hand over dialog from my lock', async () => {
    const lock = mkLock({ isMine: true, readOnly: false, candidates: vi.fn().mockResolvedValue([{ adminId: 'b1', name: 'Ravi' }]) })
    render(<DraftLockBanner lock={lock} scope="products" />)
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }))
    expect(await screen.findByRole('dialog', { name: 'Hand over draft' })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: 'Ravi' })).toBeInTheDocument()
  })
})

describe('HandoverDialog', () => {
  it('lists candidates, enables Hand over after a pick and closes on success', async () => {
    const lock = mkLock({ candidates: vi.fn().mockResolvedValue([{ adminId: 'b1', name: 'Ravi' }, { adminId: 'b2', name: 'Meera' }]) })
    const onClose = vi.fn()
    render(<HandoverDialog lock={lock} open onClose={onClose} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    const go = screen.getByRole('button', { name: 'Hand over' })
    expect(go).toBeDisabled()
    fireEvent.click(await screen.findByRole('radio', { name: 'Meera' }))
    expect(go).toBeEnabled()
    fireEvent.click(go)
    await waitFor(() => expect(lock.handover).toHaveBeenCalledWith('b2'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('says so when no other admin can take it', async () => {
    render(<HandoverDialog lock={mkLock()} open onClose={() => {}} />)
    expect(await screen.findByText('No other active admin can edit this draft.')).toBeInTheDocument()
  })

  it('stays open when the handover fails', async () => {
    const lock = mkLock({ handover: vi.fn().mockResolvedValue(false), candidates: vi.fn().mockResolvedValue([{ adminId: 'b1', name: 'Ravi' }]) })
    const onClose = vi.fn()
    render(<HandoverDialog lock={lock} open onClose={onClose} />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Ravi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }))
    await waitFor(() => expect(lock.handover).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TakeoverDialog', () => {
  it('requires a reason of 3+ characters and passes it trimmed', async () => {
    const lock = mkLock()
    const onClose = vi.fn()
    render(<TakeoverDialog lock={lock} open onClose={onClose} />)
    expect(screen.getByText(/Priya loses edit access/)).toBeInTheDocument()
    const go = screen.getByRole('button', { name: 'Take over' })
    expect(go).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '  ab ' } })
    expect(go).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '  urgent  ' } })
    expect(go).toBeEnabled()
    fireEvent.click(go)
    await waitFor(() => expect(lock.takeover).toHaveBeenCalledWith('urgent'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('Cancel closes without taking over', () => {
    const lock = mkLock()
    const onClose = vi.fn()
    render(<TakeoverDialog lock={lock} open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(lock.takeover).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/products',
  useSearchParams: () => new URLSearchParams(),
}))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
const confirmFn = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite, useHasScope: () => true }))

const lock: Record<string, any> = {}
vi.mock('@/hooks/useDraftLock', () => ({ useDraftLock: () => lock }))
const list = { rows: [] as any[], loading: false, infinite: undefined, refresh: vi.fn() }
const counts = { value: { all: 2, mine: 1, unclaimed: 1 } as any, refresh: vi.fn() }
const requestedScopes: string[] = []
vi.mock('@/hooks/useDraftsList', () => ({
  useDraftsList: (scope: string) => {
    requestedScopes.push(scope)
    return list
  },
  useDraftCounts: () => ({ counts: counts.value, refresh: counts.refresh }),
}))

import PageDrafts, { DraftsTabLabel } from '@/components/admin/drafts/PageDrafts'

const row = (over: Record<string, unknown> = {}) => ({
  resourceType: 'product', resourceId: 'p1', label: 'Drill 500W', editHref: '/admin/products/p1/edit?draft=d1', typeLabel: 'Product', writeScope: 'products', viewers: 2,
  lock: { ownerId: 'a1', ownerName: 'Asha', ownerCanEdit: true, startedAt: '2026-03-01T10:00:00Z', lastActiveAt: '2026-03-01T11:00:00Z', epoch: 1, mine: false },
  updatedAt: '2026-03-01T11:00:00Z', isMine: false, canEdit: true, canClaim: false, canTakeOver: false, canDiscard: true, ...over,
})

describe('PageDrafts', () => {
  beforeEach(() => {
    canWrite = true
    requestedScopes.length = 0
    Object.assign(lock, { isMine: false, claimable: false, closed: false, busy: false, canTakeOver: false, canDiscard: true, lock: { ownerId: 'a1', ownerName: 'Asha', ownerCanEdit: true }, claim: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(true), discard: vi.fn().mockResolvedValue(true), requestAccess: vi.fn(), handover: vi.fn(), takeover: vi.fn() })
    list.rows = [row()]
    list.loading = false
    list.refresh = vi.fn()
    counts.refresh = vi.fn()
  })

  it('shows the scope tabs with counts, children and the draft rows', () => {
    render(<PageDrafts type="product"><p>Publish row</p></PageDrafts>)
    expect(screen.getByText('Who is editing')).toBeInTheDocument()
    expect(screen.getByText('Publish row')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'In progress (2)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Mine (1)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Unclaimed (1)' })).toBeInTheDocument()
    expect(screen.getAllByText('Drill 500W').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Drill 500W' })[0].getAttribute('href')).toContain('/admin/products/p1/edit?draft=d1')
  })

  it('requests the chosen scope when a tab is picked', async () => {
    render(<PageDrafts type="product" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Mine (1)' }))
    await waitFor(() => expect(requestedScopes).toContain('mine'))
  })

  it('shows the empty message per scope', () => {
    list.rows = []
    render(<PageDrafts type="product" />)
    expect(screen.getByText('No one is editing a draft right now.')).toBeInTheDocument()
  })

  it('deletes a draft after confirming and refreshes the list', async () => {
    confirmFn.mockResolvedValue(true)
    render(<PageDrafts type="product" />)
    fireEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0])
    await waitFor(() => expect(confirmFn).toHaveBeenCalled())
    expect(confirmFn.mock.calls[0][0].message).toContain('Asha is editing this draft')
    await waitFor(() => expect(lock.discard).toHaveBeenCalled())
    await waitFor(() => expect(list.refresh).toHaveBeenCalled())
  })

  it('does not delete when the confirm is declined', async () => {
    confirmFn.mockResolvedValue(false)
    render(<PageDrafts type="product" />)
    fireEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0])
    await waitFor(() => expect(confirmFn).toHaveBeenCalled())
    expect(lock.discard).not.toHaveBeenCalled()
  })

  it('offers Claim for an unowned draft and toasts on success', async () => {
    Object.assign(lock, { claimable: true, canDiscard: false })
    render(<PageDrafts type="product" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Claim' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('You now hold this draft', 'success'))
    expect(lock.claim).toHaveBeenCalled()
  })

  it('offers Hand over and Release for my own draft', async () => {
    Object.assign(lock, { isMine: true, canDiscard: false })
    render(<PageDrafts type="product" />)
    expect(screen.getAllByRole('button', { name: 'Hand over' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Release' })[0])
    await waitFor(() => expect(lock.release).toHaveBeenCalled())
  })

  it('offers Request access when it cannot be taken over', () => {
    Object.assign(lock, { canDiscard: false, canTakeOver: false })
    render(<PageDrafts type="product" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Request access' })[0])
    expect(lock.requestAccess).toHaveBeenCalled()
  })

  it('hides the row actions without write permission', () => {
    canWrite = false
    render(<PageDrafts type="product" />)
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })
})

describe('DraftsTabLabel', () => {
  it('shows a count badge from the live counts, or the supplied count', () => {
    counts.value = { all: 2, mine: 1, unclaimed: 1 }
    const { rerender } = render(<DraftsTabLabel type="product" />)
    expect(screen.getByText('Drafts')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    rerender(<DraftsTabLabel type="product" label="Held bills" count={0} />)
    expect(screen.getByText('Held bills')).toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })
})

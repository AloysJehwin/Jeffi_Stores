import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
}))
vi.mock('@/components/ui/CopySku', () => ({ default: ({ sku }: any) => <i data-testid="copy">{sku}</i> }))

import DraftConfirmModal from '@/components/admin/DraftConfirmModal'

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

function setup(props: Partial<React.ComponentProps<typeof DraftConfirmModal>> = {}) {
  return render(
    <DraftConfirmModal productId="p1" productName="Blue Shirt" productSku="SKU-9" existingDraftId={null} {...props} />
  )
}

describe('DraftConfirmModal', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(res(200, { draftId: 'd1' }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the product, SKU and the create-draft explanation', async () => {
    setup()
    expect(await screen.findByText('Create draft to edit')).toBeInTheDocument()
    expect(screen.getByText('Blue Shirt')).toBeInTheDocument()
    expect(screen.getByTestId('copy')).toHaveTextContent('SKU-9')
    expect(screen.getByRole('button', { name: 'Create Draft & Edit' })).toBeInTheDocument()
  })

  it('creates a draft and routes to the edit page with the draft id', async () => {
    setup({ backUrl: '/admin/products' })
    fireEvent.click(await screen.findByRole('button', { name: 'Create Draft & Edit' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/products/p1/draft', { method: 'POST' })
    const url = push.mock.calls[0][0] as string
    expect(url).toContain('/admin/products/p1/edit?')
    expect(url).toContain('draft=d1')
    expect(url).toContain('back=%2Fadmin%2Fproducts')
  })

  it('with an existing draft, offers Edit Draft and goes straight to the edit page', async () => {
    setup({ existingDraftId: 'd0', entity: 'brands' })
    expect(await screen.findByText(/A draft already exists/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Draft' }))
    expect(push).toHaveBeenCalledWith('/admin/brands/p1/edit')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens the existing draft on 409', async () => {
    fetchMock.mockResolvedValue(res(409, {}))
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Create Draft & Edit' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/products/p1/edit'))
  })

  it('shows the API error for other failures', async () => {
    fetchMock.mockResolvedValue(res(500, { error: 'Nope' }))
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Create Draft & Edit' }))
    expect(await screen.findByText('Nope')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('shows a generic error when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('x'))
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Create Draft & Edit' }))
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
  })

  it('Cancel calls onClose when provided, else goes back to the list', async () => {
    const onClose = vi.fn()
    const first = setup({ onClose })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    first.unmount()
    setup({ backUrl: '/back' })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(push).toHaveBeenCalledWith('/back')
  })

  describe('draft held by someone else (423)', () => {
    beforeEach(() => {
      fetchMock.mockImplementation((url: string, init?: any) => {
        if (url.includes('/draft-locks/')) {
          if (init?.method === 'POST') return Promise.resolve(res(200, {}))
          return Promise.resolve(res(200, { canTakeOver: true }))
        }
        return Promise.resolve(res(423, { error: 'Locked', lock: { ownerName: 'Ravi', startedAt: null } }))
      })
    })

    async function openHeld() {
      setup()
      fireEvent.click(await screen.findByRole('button', { name: 'Create Draft & Edit' }))
      await screen.findByText(/Draft by Ravi/)
    }

    it('shows the holder with read-only, request-access and take-over actions', async () => {
      await openHeld()
      expect(screen.getByRole('button', { name: 'Open read-only' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Take over' })).toBeInTheDocument()
    })

    it('requests access and shows a notice', async () => {
      await openHeld()
      fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
      expect(await screen.findByText('Asked Ravi for this draft')).toBeInTheDocument()
      const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST' && String(c[0]).includes('draft-locks'))!
      expect(JSON.parse(post[1].body)).toEqual({ action: 'request_access' })
    })

    it('requires a reason to take over, then routes to edit', async () => {
      await openHeld()
      fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
      expect(await screen.findByText('Give a reason for taking over')).toBeInTheDocument()
      fireEvent.change(screen.getByPlaceholderText(/Reason for taking over/), { target: { value: ' urgent ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
      await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/products/p1/edit'))
      const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST' && String(c[0]).includes('draft-locks'))!
      expect(JSON.parse(post[1].body)).toEqual({ action: 'takeover', reason: 'urgent' })
    })

    it('opens read-only', async () => {
      await openHeld()
      fireEvent.click(screen.getByRole('button', { name: 'Open read-only' }))
      expect(push).toHaveBeenCalledWith('/admin/products/p1/edit')
    })
  })

  it('hides the create button without write permission', async () => {
    canWrite = false
    setup()
    await screen.findByText('Create draft to edit')
    expect(screen.queryByRole('button', { name: 'Create Draft & Edit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})

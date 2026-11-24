import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))

import RecordReplies from '@/components/admin/replies/RecordReplies'

const payload = {
  sessionIds: ['s1', 's2'],
  pending: 1,
  items: [
    { id: 'i1', kind: 'asked', at: '2026-03-01T10:00:00Z', scenario: 'Confirm address', status: 'answered' },
    { id: 'i2', kind: 'message', at: '2026-03-01T10:05:00Z', channel: 'whatsapp', sender: 'customer', text: 'Yes ship to office', attachments: [{ id: 'a1', kind: 'image', name: 'proof.png', url: 'https://x/proof.png' }] },
    { id: 'i3', kind: 'message', at: '2026-03-01T10:06:00Z', channel: 'whatsapp', sender: 'bot', text: 'Thanks, noted' },
    { id: 'i4', kind: 'action', at: '2026-03-01T10:07:00Z', title: 'Change address', status: 'pending', awaiting: 'admin', reading: 'Wants office address', confidence: 0.9 },
    { id: 'i5', kind: 'action', at: '2026-03-01T10:08:00Z', title: 'Cancel item', status: 'done', autoApplied: true, result: 'Item cancelled' },
  ],
}
const ok = (data: unknown) => ({ ok: true, json: async () => data })

describe('RecordReplies', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(ok(payload))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders nothing when there are no replies', async () => {
    fetchMock.mockResolvedValue(ok({ items: [], sessionIds: [], pending: 0 }))
    const { container } = render(<RecordReplies entityType="order" entityId="o1" canWrite />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the conversation: asked marker, messages, actions and the pending count', async () => {
    render(<RecordReplies entityType="order" entityId="o1" canWrite />)
    expect(await screen.findByText('Customer replies')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/replies?entityType=order&entityId=o1')
    expect(screen.getByText('1 to approve')).toBeInTheDocument()
    expect(screen.getByText(/We asked: Confirm address/)).toBeInTheDocument()
    expect(screen.getByText('Yes ship to office')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /proof\.png/ })).toHaveAttribute('href', 'https://x/proof.png')
    expect(screen.getByText(/Assistant · /)).toBeInTheDocument()
    expect(screen.getByText('Needs approval')).toBeInTheDocument()
    expect(screen.getByText(/Read as: Wants office address · 90% sure/)).toBeInTheDocument()
    expect(screen.getByText('Applied automatically')).toBeInTheDocument()
    expect(screen.getByText('Item cancelled')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open conversation' }).getAttribute('href')).toContain('s=s2')
  })

  it('approves a pending action with the note and reloads', async () => {
    const changed = vi.fn()
    window.addEventListener('admin-agent:changed', changed)
    render(<RecordReplies entityType="order" entityId="o1" canWrite />)
    fireEvent.change(await screen.findByPlaceholderText('Note to the customer (optional)'), { target: { value: 'Done' } })
    fetchMock.mockResolvedValueOnce(ok({}))
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Approved and applied', 'success'))
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('/api/admin/replies/actions/i4')
    expect(JSON.parse(post[1].body)).toEqual({ decision: 'approve', note: 'Done' })
    expect(changed).toHaveBeenCalled()
    window.removeEventListener('admin-agent:changed', changed)
  })

  it('rejects and surfaces an error', async () => {
    render(<RecordReplies entityType="order" entityId="o1" canWrite />)
    const reject = await screen.findByRole('button', { name: /Reject/ })
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Already decided' }) })
    fireEvent.click(reject)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already decided', 'error'))
  })

  it('hides the decision controls without write access', async () => {
    render(<RecordReplies entityType="order" entityId="o1" canWrite={false} />)
    await screen.findByText('Needs approval')
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
  })
})

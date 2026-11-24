import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/admin/support/SupportConversation', () => ({
  default: ({ sessionId, inCustomerPage }: any) => (
    <div data-testid="conv">
      {sessionId}|{String(inCustomerPage)}
    </div>
  ),
}))

import AdminSupportChat from '@/components/admin/AdminSupportChat'

const json = (sessions: { id: string }[]) => ({ ok: true, json: async () => ({ sessions }) })

describe('AdminSupportChat', () => {
  it('shows Loading while looking up, then the open conversation', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue(json([{ id: 's-open' }]))
    vi.stubGlobal('fetch', f)
    render(<AdminSupportChat customerId="c9" />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByTestId('conv')).toHaveTextContent('s-open|true')
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('/api/admin/support/sessions?customerId=c9&filter=open&limit=1')
  })

  it('falls back to the latest closed conversation', async () => {
    const f = vi
      .fn<(...a: any[]) => any>()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([{ id: 's-closed' }]))
    vi.stubGlobal('fetch', f)
    render(<AdminSupportChat customerId="c9" />)
    expect(await screen.findByTestId('conv')).toHaveTextContent('s-closed')
    expect(f.mock.calls[1][0]).toContain('filter=closed')
  })

  it('shows the empty state when there are no chats', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(json([])))
    render(<AdminSupportChat customerId="c9" />)
    expect(await screen.findByText('This customer has no support chats yet.')).toBeInTheDocument()
  })

  it('treats failed requests as no chats', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('x')))
    render(<AdminSupportChat customerId="c9" />)
    expect(await screen.findByText('This customer has no support chats yet.')).toBeInTheDocument()
  })
})

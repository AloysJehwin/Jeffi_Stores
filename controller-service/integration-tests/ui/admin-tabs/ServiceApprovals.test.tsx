import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))

import ServiceApprovals from '@controller/components/admin/ecom/tabs/ServiceApprovals'

const pending = (service: string) => ({ service, status: 'pending', requested_at: '2026-11-20T10:00:00Z', reviewed_at: null, note: '' }) as any
const view = (props: Partial<React.ComponentProps<typeof ServiceApprovals>> = {}) =>
  render(
    <ToastProvider>
      <ServiceApprovals tenantId="t1" services={['messaging']} approvals={[pending('messaging')]} {...props} />
    </ToastProvider>,
  )
const mockFetch = (status: number, body: any) => {
  const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: status < 400, status, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}

describe('ServiceApprovals', () => {
  it('renders nothing when the store has neither Messaging nor Documents', () => {
    const { container } = view({ services: ['store'], approvals: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('treats a service with no review row as approved before reviews existed', () => {
    view({ services: ['documents'], approvals: [] })
    expect(screen.getByText('Documents API')).toBeInTheDocument()
    expect(screen.getByText('Approved before reviews existed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
  })

  it('lists a pending service with its request time and KYB badge', () => {
    view({ readiness: { messaging: { ready: false, verified: false, todo: [{ label: 'PAN' }] } } })
    expect(screen.getByText('Messaging API')).toBeInTheDocument()
    expect(screen.getByText(/Requested /)).toBeInTheDocument()
    expect(screen.getByText('KYB: 1 to do')).toBeInTheDocument()
  })

  it('approves a service and refreshes', async () => {
    const f = mockFetch(200, { ok: true })
    view()
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(await screen.findByText('Messaging API approved.')).toBeInTheDocument()
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/admin/ecom/customers/t1/services')
    expect(JSON.parse(init.body)).toEqual({ service: 'messaging', decision: 'approved' })
    expect(refresh).toHaveBeenCalled()
  })

  it('requires a reason before the rejection can be sent, then posts it', async () => {
    const f = mockFetch(200, { ok: true })
    view()
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }))
    const send = screen.getByRole('button', { name: /Send rejection/ })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Reason (sent to the owner)'), { target: { value: 'Use case unclear' } })
    expect(send).toBeEnabled()
    fireEvent.click(send)
    expect(await screen.findByText('Messaging API rejected.')).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ service: 'messaging', decision: 'rejected', note: 'Use case unclear' })
  })

  it('shows the KYB gate on a 409 and forces approval from it', async () => {
    const f = vi
      .fn<(...a: any[]) => any>()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ canForce: true, error: 'Incomplete', missing: { messaging: [{ item: 'use', label: 'Use case' }] } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', f)
    view()
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use case')
    fireEvent.click(screen.getByRole('button', { name: /Approve anyway/ }))
    expect(await screen.findByText('Messaging API approved.')).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls[1][1].body)).toMatchObject({ decision: 'approved', force: true })
  })

  it('toasts a server failure and keeps the row actionable', async () => {
    mockFetch(500, { error: 'Mail provider down' })
    view()
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(await screen.findByText('Mail provider down')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

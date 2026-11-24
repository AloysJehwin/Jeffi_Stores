import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, hint }: any) => (
    <div>
      <select aria-label="ttl" value={value} onChange={e => onChange(e.target.value)}>
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <span>{hint}</span>}
    </div>
  ),
}))

import AuthorizeClient from '@admin/app/(admin)/admin/cli/authorize/AuthorizeClient'

const pending = { clientName: 'laptop', clientIp: '10.0.0.5', userAgent: 'jeffi/1.2', createdAt: '2026-03-01T10:00:00Z', expiresAt: '2026-03-01T10:15:00Z' } as any
const props = { initialCode: 'ABCD-1234', pending, administrator: false, scopeHint: '' as const, customScopes: '', ttlHint: '' }
const fetchMock = vi.fn()

describe('AuthorizeClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows who is asking and the defaults (read only, 12 hours)', () => {
    render(<AuthorizeClient {...props} />)
    expect(screen.getByText('laptop')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument()
    expect(screen.getByText('jeffi/1.2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ABCD-1234')).toBeInTheDocument()
    expect(screen.getByLabelText('ttl')).toHaveValue('12h')
    expect(screen.getAllByRole('radio')[0]).toBeChecked()
  })

  it('explains when no live request has the code, or none was entered', () => {
    const { unmount } = render(<AuthorizeClient {...props} pending={null} />)
    expect(screen.getByText(/No live request has this code/)).toBeInTheDocument()
    unmount()
    render(<AuthorizeClient {...props} pending={null} initialCode="" />)
    expect(screen.getByText(/Enter the code your terminal shows/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
  })

  it('approves read-only access and shows the confirmation', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'approved', expires_at: '2026-03-02T00:00:00Z', scopes: ['a:read', 'b:read'] }) })
    render(<AuthorizeClient {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Approved. You can return to your terminal.')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/cli/approve')
    expect(JSON.parse(init.body)).toEqual({ user_code: 'ABCD-1234', decision: 'approve', scopes: 'read', ttl: '12h' })
    expect(screen.getByText(/2 scope\(s\)/)).toBeInTheDocument()
  })

  it('sends a custom scope list split on spaces and commas, with the chosen ttl', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'approved', scopes: ['*'] }) })
    render(<AuthorizeClient {...props} />)
    fireEvent.click(screen.getByLabelText(/Specific scopes/))
    fireEvent.change(screen.getByPlaceholderText('products:write orders:read'), { target: { value: 'products:write, orders:read  tasks:read' } })
    fireEvent.change(screen.getByLabelText('ttl'), { target: { value: '7d' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await screen.findByText(/Approved/)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.scopes).toEqual(['products:write', 'orders:read', 'tasks:read'])
    expect(body.ttl).toBe('7d')
    expect(screen.getByText(/Everything you can do/)).toBeInTheDocument()
  })

  it('deny reports denied', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'denied' }) })
    render(<AuthorizeClient {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(await screen.findByText(/Denied/)).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).decision).toBe('deny')
  })

  it('surfaces the API error and keeps the form', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Code expired' }) })
    render(<AuthorizeClient {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Code expired')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled()
  })

  it('falls back to an HTTP status message when the body has no error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('x') } })
    render(<AuthorizeClient {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByText('Failed (HTTP 500)')).toBeInTheDocument())
  })

  it('administrators cannot pick 7 days and see the 24-hour cap', () => {
    render(<AuthorizeClient {...props} administrator ttlHint="7d" />)
    expect(screen.queryByRole('option', { name: '7 days' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('ttl')).toHaveValue('12h')
    expect(screen.getByText(/at most 24 hours/)).toBeInTheDocument()
  })
})

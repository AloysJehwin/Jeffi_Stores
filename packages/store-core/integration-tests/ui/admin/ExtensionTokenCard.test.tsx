import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
}))

import ExtensionTokenCard from '@/components/admin/ExtensionTokenCard'

const res = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body })

describe('ExtensionTokenCard', () => {
  beforeEach(() => {
    canWrite = true
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined) } })
  })

  it('renders the masked token and copy button', () => {
    render(<ExtensionTokenCard />)
    expect(screen.getByText('Chrome Extension Token')).toBeInTheDocument()
    expect(screen.getByText(/jfc_•+/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Token' })).toBeInTheDocument()
  })

  it('mints a scoped token and copies it', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue(res(200, { token: 'jfc_abc' }))
    vi.stubGlobal('fetch', f)
    render(<ExtensionTokenCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('jfc_abc')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/admin/cli/tokens')
    expect(JSON.parse(init.body)).toMatchObject({ kind: 'extension', scopes: ['products:write'], ttl: '24h' })
  })

  it.each([
    [401, /session expired/],
    [403, /lacks the products:write permission/],
    [500, /HTTP 500/],
  ])('shows an error for HTTP %s', async (status, msg) => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(status)))
    render(<ExtensionTokenCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
    expect(await screen.findByText(msg)).toBeInTheDocument()
  })

  it('errors when the server returns no token', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(200, {})))
    render(<ExtensionTokenCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
    expect(await screen.findByText('No token returned by the server.')).toBeInTheDocument()
  })

  it('shows the token for manual copy when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(200, { token: 'jfc_manual' })))
    render(<ExtensionTokenCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
    expect(await screen.findByDisplayValue('jfc_manual')).toBeInTheDocument()
    expect(screen.getByText(/Auto-copy unavailable/)).toBeInTheDocument()
  })

  it('falls back to showing the token when the clipboard write is blocked', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('no')) } })
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(200, { token: 'jfc_blocked' })))
    render(<ExtensionTokenCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
    await waitFor(() => expect(screen.getByDisplayValue('jfc_blocked')).toBeInTheDocument())
  })

  it('hides the copy button without settings:write', () => {
    canWrite = false
    render(<ExtensionTokenCard />)
    expect(screen.queryByRole('button', { name: 'Copy Token' })).toBeNull()
  })
})

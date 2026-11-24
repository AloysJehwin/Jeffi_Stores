import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/components/admin/CopyLinkButton', () => ({ default: ({ url }: any) => <span data-testid="copy">{url}</span> }))

import OwnAppPanel from '@/components/admin/integrations/OwnAppPanel'

const state = (over: Record<string, unknown> = {}) => ({
  family: 'google', label: 'Google OAuth client', own: false, clientId: null, applicationId: null, platformReady: true, redirectUris: ['https://x/cb'], ...over,
})
const ok = (data: unknown) => ({ ok: true, json: async () => data })

describe('OwnAppPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(ok(state()))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the platform-app status and opens the setup form', async () => {
    render(<OwnAppPanel family="google" />)
    expect(await screen.findByText(/Sign-in uses the platform's app/)).toBeInTheDocument()
    expect(screen.getByText('Your own Google OAuth client')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use your own' }))
    expect(screen.getByText(/Add this as the redirect URI/)).toBeInTheDocument()
    expect(screen.getByTestId('copy')).toHaveTextContent('https://x/cb')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves a new app with the write header and calls onChange', async () => {
    const onChange = vi.fn()
    render(<OwnAppPanel family="google" onChange={onChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use your own' }))
    const [id, secret] = screen.getAllByRole('textbox').concat(Array.from(document.querySelectorAll('input[type=password]')) as never[])
    fireEvent.change(id, { target: { value: ' cid ' } })
    fireEvent.change(secret as Element, { target: { value: 'sec' } })
    fetchMock.mockResolvedValueOnce(ok({}))
    fetchMock.mockResolvedValueOnce(ok(state({ own: true, clientId: 'cid' })))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved. Connect again to sign in with your app.')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('/api/admin/integrations/oauth-app/google')
    expect(post[1].headers['x-requested-with']).toBe('jeffi-admin')
    expect(JSON.parse(post[1].body)).toEqual({ clientId: 'cid', clientSecret: 'sec' })
    expect(onChange).toHaveBeenCalled()
  })

  it('requires an application id for Amazon Seller', async () => {
    fetchMock.mockResolvedValue(ok(state({ family: 'amazon_seller', label: 'Amazon Selling Partner app' })))
    render(<OwnAppPanel family="amazon_seller" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use your own' }))
    expect(screen.getByPlaceholderText('amzn1.sp.solution…')).toBeInTheDocument()
  })

  it('manages an own app and removes it after a confirming second click', async () => {
    fetchMock.mockResolvedValue(ok(state({ own: true, clientId: 'cid', platformReady: true })))
    render(<OwnAppPanel family="google" />)
    expect(await screen.findByText(/Sign-in uses your app \(cid\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    const remove = screen.getByRole('button', { name: 'Use platform app' })
    fetchMock.mockResolvedValueOnce(ok({}))
    fireEvent.click(remove)
    expect(screen.getByRole('button', { name: 'Click again to confirm' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Click again to confirm' }))
    expect(await screen.findByText(/Sign-in uses the platform app again/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(true)
  })

  it('shows a permission note without write access, and hides itself on insufficient permissions', async () => {
    canWrite = false
    const { container, unmount } = render(<OwnAppPanel family="google" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use your own' }))
    expect(screen.getByText(/don't have permission to change this app/)).toBeInTheDocument()
    unmount()
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Insufficient permissions' }) })
    const hidden = render(<OwnAppPanel family="google" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(hidden.container).toBeEmptyDOMElement())
    expect(container).toBeDefined()
  })

  it('shows a load error banner', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Boom' }) })
    render(<OwnAppPanel family="x" />)
    expect(await screen.findByText('Boom')).toBeInTheDocument()
  })
})

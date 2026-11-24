import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

import ApiKeysClient from '@controller/app/(ecom)/ecom/dashboard/api-keys/ApiKeysClient'

const key = (over: Record<string, unknown> = {}) => ({
  id: 'k1', name: 'Prod backend', key_prefix: 'jk_live_ab12', scopes: ['messages:send', 'wallet:read'], status: 'active', last_used_at: null, created_at: '2026-11-01T00:00:00Z', requests_30d: 42, spend_paise_30d: '1250', ...over,
})
function mockApi(keys: any[], post?: { ok: boolean; body: any }) {
  const f = vi.fn<(...a: any[]) => any>(async (url: string, init?: any) => {
    if (init?.method === 'POST') return { ok: post?.ok ?? true, json: async () => post?.body ?? { key: 'jk_live_SECRET' } }
    if (init?.method === 'DELETE') return { ok: true, json: async () => ({}) }
    return { ok: true, json: async () => ({ keys }) }
  })
  vi.stubGlobal('fetch', f)
  return f
}
const view = (services = { messaging: true, documents: false }, approved = true) =>
  render(
    <ToastProvider>
      <ApiKeysClient services={services} approved={approved} docsUrl="https://api.jeffistores.in" />
    </ToastProvider>,
  )

describe('ApiKeysClient', () => {
  it('lists keys with their prefix, scope count, 30-day use in rupees and a revoke action', async () => {
    mockApi([key()])
    view()
    expect(await screen.findByText('Prod backend')).toBeInTheDocument()
    expect(screen.getByText('jk_live_ab12…')).toBeInTheDocument()
    expect(screen.getByText('2 scopes')).toBeInTheDocument()
    expect(screen.getByText('42 req · ₹12.50')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /API documentation/ })).toHaveAttribute('href', 'https://api.jeffistores.in/docs')
  })

  it('revokes a key and reloads the list', async () => {
    const f = mockApi([key()])
    view()
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    await vi.waitFor(() => expect(f.mock.calls.some(c => c[0] === '/api/ecom/api-keys/k1' && c[1]?.method === 'DELETE')).toBe(true))
    expect(f.mock.calls.filter(c => !c[1]).length).toBeGreaterThanOrEqual(2)
  })

  it('shows a revoked key greyed without a revoke button', async () => {
    mockApi([key({ status: 'revoked' })])
    view()
    expect(await screen.findByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('shows the empty state for an approved workspace', async () => {
    mockApi([])
    view()
    expect(await screen.findByText('No keys yet')).toBeInTheDocument()
    expect(screen.getByText('Create one above to start calling the API.')).toBeInTheDocument()
  })

  it('says keys work once approved when the service is under review', async () => {
    mockApi([])
    view({ messaging: true, documents: false }, false)
    expect(await screen.findByText(/It works once Jeffi approves your service/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Go to Services' }).length).toBeGreaterThan(0)
  })

  it('without any service hides the form and sends the owner to add one', async () => {
    mockApi([])
    view({ messaging: false, documents: false }, false)
    expect(await screen.findByText(/Keys come with a service/)).toBeInTheDocument()
    expect(screen.queryByText('Create a key')).toBeNull()
    expect(screen.getByRole('link', { name: 'Add a service' })).toHaveAttribute('href', '/dashboard/services')
  })

  it('offers only the scopes of the services the workspace has, and nudges to add the other', async () => {
    mockApi([])
    view({ messaging: true, documents: false })
    await screen.findByText('No keys yet')
    expect(screen.getByRole('button', { name: 'Send messages' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Render documents' })).toBeNull()
    expect(screen.getByText(/Also need the Documents API/)).toBeInTheDocument()
  })

  it('requires a name, then creates the key and shows the secret once with a curl example', async () => {
    const f = mockApi([])
    view()
    await screen.findByText('No keys yet')
    const create = screen.getByRole('button', { name: 'Create key' })
    expect(create).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Production backend'), { target: { value: 'CI' } })
    expect(create).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Read wallet balance' }))
    fireEvent.click(create)
    expect(await screen.findByText('jk_live_SECRET')).toBeInTheDocument()
    expect(screen.getByText('Copy it now — it will not be shown again.')).toBeInTheDocument()
    expect(screen.getByText(/curl https:\/\/api.jeffistores.in\/v1\/messages/)).toBeInTheDocument()
    const post = f.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('/api/ecom/api-keys')
    expect(JSON.parse(post[1].body)).toEqual({ name: 'CI', scopes: ['messages:send', 'templates:read', 'templates:write'] })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('jk_live_SECRET')).toBeNull()
  })

  it('toasts the API error when the key cannot be created', async () => {
    mockApi([], { ok: false, body: { error: 'Key limit reached' } })
    view()
    await screen.findByText('No keys yet')
    fireEvent.change(screen.getByPlaceholderText('Production backend'), { target: { value: 'CI' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByText('Key limit reached')).toBeInTheDocument()
  })
})

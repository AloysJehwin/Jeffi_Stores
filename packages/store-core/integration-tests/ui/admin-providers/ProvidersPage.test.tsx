import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { T1, mockApi, platformData, storeData, writes } from './fixtures'

// Settings → Providers page: GET /api/admin/settings/providers (?tenant= for a store when the flagship picks one),
// then the channel row, AI routing and, for the flagship's platform scope, integrations and secrets.

vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => null, useToast: () => ({ showToast: vi.fn() }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import ProvidersPage from '@/components/admin/providers/ProvidersPage'

const loaded = () => screen.findByRole('heading', { name: 'AI routing' })

describe('ProvidersPage', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('shows the skeleton while loading', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    render(<ProvidersPage />)
    expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument()
    expect(screen.getByText("Configuration only. Keys live in the platform's secrets.")).toBeInTheDocument()
    expect(screen.getByLabelText('Loading providers')).toBeInTheDocument()
  })

  it('renders the flagship platform view: channels, routing, integrations and secrets', async () => {
    mockApi(() => platformData())
    render(<ProvidersPage />)
    await loaded()
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveTextContent('Platform default')
    expect(screen.getByRole('combobox', { name: 'SMS provider' })).toHaveTextContent('Twilio')
    expect(screen.getByRole('combobox', { name: 'WhatsApp provider' })).toHaveTextContent('AWS')
    expect(screen.getByRole('combobox', { name: 'Calling provider' })).toHaveTextContent('Exotel')
    // Calling card and the Exotel integration both name the missing secret.
    expect(screen.getAllByText('EXOTEL_API_TOKEN missing')).toHaveLength(2)
    expect(screen.getAllByText('Keys in secrets').length).toBeGreaterThan(0)
    for (const row of ['Text and chat', 'Images', 'Video', 'Speech to text', 'Text to speech', 'Embeddings']) expect(screen.getAllByText(row).length).toBeGreaterThan(0)
    expect(screen.getByText('Vision follows text.')).toBeInTheDocument()
    const integrations = screen.getByRole('heading', { name: 'Integrations' }).closest('section')!
    for (const box of ['Exotel calling', 'Twilio test line', 'Call voice', 'SMS India DLT']) expect(within(integrations).getByText(box)).toBeInTheDocument()
    const secrets = screen.getByRole('heading', { name: 'Secrets' }).closest('section')!
    expect(within(secrets).getByText('8 of 10 set')).toBeInTheDocument()
    expect(within(within(secrets).getByRole('list', { name: 'Calling secrets' })).getByText('EXOTEL_API_TOKEN')).toBeInTheDocument()
    expect(within(secrets).getByText('jeffi/ai-gateway/production')).toBeInTheDocument()
  })

  it('has no credential inputs anywhere', async () => {
    mockApi(() => platformData())
    const { container } = render(<ProvidersPage />)
    await loaded()
    expect(container.querySelectorAll('input[type="password"]').length).toBe(0)
    const labels = Array.from(container.querySelectorAll('input')).map(i => i.getAttribute('aria-label') ?? '')
    expect(labels.length).toBeGreaterThan(10)
    expect(labels.filter(l => /key|token|secret|password|auth/i.test(l))).toEqual([])
  })

  it('switches the flagship to a store and loads its overrides', async () => {
    const calls = mockApi(url => (url.includes('tenant=') ? storeData({ canEdit: { messaging: true, calling: false, ai: true, integrations: false }, secrets: [] }) : platformData()))
    render(<ProvidersPage />)
    await loaded()
    fireEvent.click(screen.getByRole('combobox', { name: 'Scope' }))
    fireEvent.click(await screen.findByRole('option', { name: /Acme Store/ }))
    await screen.findByText(/Anything without a store override follows the platform default/)
    expect(calls.some(c => c.method === 'GET' && c.url.endsWith(`?tenant=${T1}`))).toBe(true)
    expect(screen.queryByRole('combobox', { name: 'Calling provider' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Integrations' })).not.toBeInTheDocument()
    expect(screen.getByTestId('route-image')).toHaveTextContent('Store override')
    expect(screen.getByTestId('route-text')).toHaveTextContent('Inherited from platform')
  })

  it('renders a store admin its own store: messaging read-only, no calling, integrations or secrets', async () => {
    const calls = mockApi(() => storeData())
    render(<ProvidersPage />)
    await loaded()
    expect(calls[0].url).toBe('/api/admin/settings/providers')
    expect(screen.getByText('Acme Store')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Scope' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'SMS provider' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Managed by the platform')).toHaveLength(2)
    expect(screen.queryByText('Calling')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Integrations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Secrets' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save AI routing' })).toBeInTheDocument()
    expect(screen.getByTestId('route-text')).toHaveTextContent('Inherited from platform')
  })

  it('saves a store admin reorder against its own store', async () => {
    const calls = mockApi(() => storeData())
    render(<ProvidersPage />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Move Razer up in Text and chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save AI routing' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0]).toMatchObject({ method: 'PUT', url: '/api/admin/settings/providers', body: { tenantId: T1, key: 'ai_text_providers', value: ['razer', 'anthropic'] } })
    await waitFor(() => expect(calls.filter(c => c.method === 'GET')).toHaveLength(2))
  })

  it('keeps routing editable from saved settings when the gateway is down', async () => {
    mockApi(() => platformData({ gateway: null, settings: { ...platformData().settings, ai_models: { text: { anthropic: 'claude-opus-5-5' } } } }))
    render(<ProvidersPage />)
    await loaded()
    expect(screen.getByText(/The AI gateway did not answer/)).toBeInTheDocument()
    const claude = screen.getByTestId('chip-text-anthropic')
    expect(claude).toHaveTextContent('claude-opus-5-5')
    expect(claude).toHaveTextContent('₹1.008')
    expect(within(claude).queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Razer up in Text and chat' })).toBeEnabled()
  })

  it('shows the error state with a retry when the load fails', async () => {
    mockApi(() => ({}), { 'GET /api/admin/settings/providers': { status: 500, body: { error: 'Database unavailable' } } })
    render(<ProvidersPage />)
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('asks the flagship to pick a store on the overrides page', async () => {
    const calls = mockApi(url => (url.includes('tenant=') ? storeData({ canEdit: { messaging: true, calling: false, ai: true, integrations: false } }) : platformData()))
    render(<ProvidersPage variant="overrides" />)
    expect(await screen.findByText('Pick a store', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Store overrides' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI routing' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Store' }))
    expect(screen.queryByRole('option', { name: /Platform default/ })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('option', { name: /Acme Store/ }))
    await loaded()
    expect(calls.at(-1)!.url).toContain(`tenant=${T1}`)
    expect(screen.getByRole('combobox', { name: 'SMS provider' })).toBeInTheDocument()
  })
})

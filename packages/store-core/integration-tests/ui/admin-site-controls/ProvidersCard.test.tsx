import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// ProvidersCard (flagship admin): loads provider policy from /api/admin/settings/providers via kit api()
// on mount, showing a skeleton first. view 'default' = platform policy; view 'overrides' = per-store table.
// fetch is mocked; useActionToast is a no-op outside a ToastProvider (useToastOptional -> null).

vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => null, useToast: () => ({ showToast: vi.fn() }) }))

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import ProvidersCard from '@/components/admin/site-controls/ProvidersCard'

const data = {
  settings: [
    { tenant_id: null, key: 'sms_provider', value: 'twilio', updated_by: 'root', updated_at: '2026-11-01T00:00:00Z' },
    { tenant_id: 't1', key: 'whatsapp_provider', value: 'aws', updated_by: 'admin', updated_at: '2026-11-02T00:00:00Z' },
  ],
  tenants: [{ id: 't1', slug: 'acme', display_name: 'Acme Store' }],
  messaging: { sms: { twilio: true, aws: false }, whatsapp: { twilio: true, aws: true } },
  gateway: {
    text: [{ name: 'anthropic', configured: true }],
    image: [{ name: 'razer', configured: false }],
    video: [],
    defaults: { text: ['anthropic'], image: ['razer'], video: ['google'] },
  },
}

function dataFetch(body: any = data) {
  return vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => body })
}

describe('ProvidersCard (default view)', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('renders the loading skeleton before data arrives', () => {
    // Never-resolving fetch keeps the skeleton on screen.
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockReturnValue(new Promise(() => {})))
    render(<ProvidersCard view="default" />)
    expect(screen.getByLabelText('Loading providers')).toBeInTheDocument()
  })

  it('renders the messaging and AI sections once loaded', async () => {
    vi.stubGlobal('fetch', dataFetch())
    render(<ProvidersCard view="default" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument())
    expect(screen.getByText('Messaging')).toBeInTheDocument()
    expect(screen.getByText('AI')).toBeInTheDocument()
    // Messaging selects labelled by setting.
    expect(screen.getByRole('combobox', { name: 'SMS provider' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'WhatsApp provider' })).toBeInTheDocument()
    // AI order editors.
    expect(screen.getByText('AI text order')).toBeInTheDocument()
    expect(screen.getByText('AI image order')).toBeInTheDocument()
  })

  it('shows the gateway-unknown note when the gateway did not answer', async () => {
    vi.stubGlobal('fetch', dataFetch({ ...data, gateway: null }))
    render(<ProvidersCard view="default" />)
    await waitFor(() => expect(screen.getByText(/The AI gateway did not answer/)).toBeInTheDocument())
  })

  it('surfaces a load error banner when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'nope' }) }))
    render(<ProvidersCard view="default" />)
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument())
  })
})

describe('ProvidersCard (overrides view)', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('lists the store overrides with the resolved store name and value', async () => {
    vi.stubGlobal('fetch', dataFetch())
    render(<ProvidersCard view="overrides" />)
    expect(screen.getByRole('heading', { name: 'Store overrides' })).toBeInTheDocument()
    // The heading shows while loading; wait for the one override row: Acme Store / WhatsApp provider / AWS.
    await waitFor(() => expect(screen.getByText('Acme Store')).toBeInTheDocument())
    expect(screen.getByText('WhatsApp provider')).toBeInTheDocument()
    expect(screen.getByText('AWS')).toBeInTheDocument()
  })

  it('shows the Add override action for a writer', async () => {
    vi.stubGlobal('fetch', dataFetch())
    render(<ProvidersCard view="overrides" />)
    await waitFor(() => expect(screen.getByText('Add override')).toBeInTheDocument())
  })

  it('renders an empty overrides table when there are none', async () => {
    vi.stubGlobal('fetch', dataFetch({ ...data, settings: [] }))
    render(<ProvidersCard view="overrides" />)
    await waitFor(() => expect(screen.getByText(/No store overrides/)).toBeInTheDocument())
  })
})

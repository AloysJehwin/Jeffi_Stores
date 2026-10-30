import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))

import AdminIntegrationsPopup from '@/components/admin/AdminIntegrationsPopup'

const OFF = { enabled: false, redirectUri: 'https://admin.jeffistores.in/api/admin/integrations/amazon/callback' }
const ON = { enabled: true, redirectUri: 'https://admin.jeffistores.in/api/admin/integrations/google/callback' }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('AdminIntegrationsPopup', () => {
  it('opens itself with the OAuth result and clears the params', async () => {
    window.history.replaceState({}, '', '/admin/amazon?connected=0&provider=amazon&error=bad_state')
    render(<AdminIntegrationsPopup scope="merchant" integrations={[]} socialAccounts={[]} oauth={{}} />)
    expect(await screen.findByText(/Could not connect Amazon Seller: the sign-in link expired/)).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('offers OAuth only when configured and lists the redirect URI otherwise', () => {
    render(
      <AdminIntegrationsPopup
        scope="merchant"
        integrations={[]}
        socialAccounts={[]}
        oauth={{ google_merchant: ON, amazon_seller: OFF }}
      />
    )
    fireEvent.click(screen.getByText('Configure'))
    expect(screen.getByText('Connect with Google')).toBeTruthy()
    expect(screen.queryByText('Connect with Amazon')).toBeNull()
    expect(screen.getByText(OFF.redirectUri)).toBeTruthy()
  })

  it('shows the method in use and runs Test connection', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'Reached Amazon seller A1 on A21TJRUUN4KGV.' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AdminIntegrationsPopup
        scope="merchant"
        integrations={[
          {
            provider: 'amazon_seller',
            label: null,
            status: 'connected',
            meta: { seller_id: 'A1', connected_via: 'oauth' },
          },
        ]}
        socialAccounts={[]}
        oauth={{ amazon_seller: OFF }}
      />
    )
    fireEvent.click(screen.getByText('Configure'))
    expect(screen.getByText('Seller Central authorization')).toBeTruthy()
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText('Reached Amazon seller A1 on A21TJRUUN4KGV.')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/integrations/test', expect.objectContaining({ method: 'POST' }))
  })

  it('saves a manual Meta Page token through the social accounts route', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, page_name: 'Acme', instagram: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminIntegrationsPopup scope="social" integrations={[]} socialAccounts={[]} oauth={{ meta: OFF }} />)
    fireEvent.click(screen.getByText('Configure'))
    fireEvent.click(screen.getByText('Enter Page token'))
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: '1234567' } })
    fireEvent.change(document.querySelector('input[type=password]')!, {
      target: { value: 'EAAG-token-value-long-enough' },
    })
    fireEvent.click(screen.getByText('Save and verify'))
    await waitFor(() => expect(screen.getByText('Connected to Acme and its Instagram account.')).toBeTruthy())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/social/accounts')
    expect(JSON.parse(String(init.body))).toEqual({
      page_id: '1234567',
      access_token: 'EAAG-token-value-long-enough',
      ig_user_id: '',
    })
    expect(refresh).toHaveBeenCalled()
  })
})

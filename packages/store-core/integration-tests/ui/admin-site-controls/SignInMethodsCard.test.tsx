import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// SignInMethodsCard: one ProviderCard per method. Toggle/Save/Remove call /api/admin/sign-in-methods/<p>;
// contexts are mocked and fetch returns the updated method so the card re-reads its state.

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import SignInMethodsCard from '@/components/admin/site-controls/SignInMethodsCard'
import type { SignInMethodAdminView } from '@/lib/auth/social/config'

const method = (over: Partial<SignInMethodAdminView> = {}): SignInMethodAdminView => ({
  provider: 'google',
  enabled: true,
  configured: false,
  clientId: '',
  teamId: '',
  keyId: '',
  secretLast4: '',
  ...over,
})

const redirectUris = {
  google: [{ label: 'Store', uri: 'https://shop.test/cb' }],
  facebook: [],
  apple: [],
  github: [],
}

function fetchReturning(next: SignInMethodAdminView) {
  return vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ method: next }) })
}

describe('SignInMethodsCard', () => {
  beforeEach(() => {
    showToast.mockReset()
    canWrite = true
  })

  it('renders a card per method with its label and redirect URI', () => {
    render(<SignInMethodsCard methods={[method({ provider: 'google' }), method({ provider: 'github', enabled: false })]} redirectUris={redirectUris} />)
    expect(screen.getByRole('heading', { name: 'Google' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeInTheDocument()
    expect(screen.getByText('https://shop.test/cb')).toBeInTheDocument()
  })

  it('shows "On, platform app" for an enabled, unconfigured Google method', () => {
    render(<SignInMethodsCard methods={[method({ provider: 'google', enabled: true, configured: false })]} redirectUris={redirectUris} />)
    expect(screen.getByText('On, platform app')).toBeInTheDocument()
  })

  it('shows the stored-secret placeholder and ending-4 hint when configured', () => {
    render(<SignInMethodsCard methods={[method({ provider: 'google', configured: true, clientId: 'abc.apps', secretLast4: '7Z9x' })]} redirectUris={redirectUris} />)
    expect(screen.getByText('On, your app')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Stored, ends in 7Z9x/)).toBeInTheDocument()
  })

  it('offers a Remove button only when the method is configured', () => {
    const { unmount } = render(<SignInMethodsCard methods={[method({ provider: 'google', configured: false })]} redirectUris={redirectUris} />)
    expect(screen.queryByRole('button', { name: 'Remove app' })).not.toBeInTheDocument()
    unmount()
    render(<SignInMethodsCard methods={[method({ provider: 'google', configured: true })]} redirectUris={redirectUris} />)
    expect(screen.getByRole('button', { name: 'Remove app' })).toBeInTheDocument()
  })

  it('saves the typed credentials with a PUT and toasts Saved', async () => {
    const fetchMock = fetchReturning(method({ provider: 'google', clientId: 'new.apps' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SignInMethodsCard methods={[method({ provider: 'google' })]} redirectUris={redirectUris} />)
    const clientId = screen.getByLabelText('Client ID')
    fireEvent.change(clientId, { target: { value: '  new.apps  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/sign-in-methods/google')
    expect(init.method).toBe('PUT')
    // Trimmed before sending.
    expect(JSON.parse(init.body).clientId).toBe('new.apps')
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved', 'success'))
  })

  it('surfaces a server error inline and via a toast', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'Bad client' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<SignInMethodsCard methods={[method({ provider: 'google' })]} redirectUris={redirectUris} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Bad client', 'error'))
    expect(screen.getByText('Bad client')).toBeInTheDocument()
  })

  it('hides the Save/Remove actions when the admin cannot write', () => {
    canWrite = false
    render(<SignInMethodsCard methods={[method({ provider: 'google', configured: true })]} redirectUris={redirectUris} />)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove app' })).not.toBeInTheDocument()
  })

  it('renders the apple-specific fields (Team ID, Key ID, private key)', () => {
    render(<SignInMethodsCard methods={[method({ provider: 'apple' })]} redirectUris={redirectUris} />)
    const card = screen.getByRole('heading', { name: 'Apple' }).closest('section')!
    const c = within(card)
    expect(c.getByLabelText('Services ID')).toBeInTheDocument()
    expect(c.getByLabelText('Team ID')).toBeInTheDocument()
    expect(c.getByLabelText('Key ID')).toBeInTheDocument()
    expect(c.getByLabelText('Private key (.p8)')).toBeInTheDocument()
  })
})

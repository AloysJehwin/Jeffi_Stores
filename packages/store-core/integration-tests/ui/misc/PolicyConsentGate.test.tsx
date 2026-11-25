import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
let pathname = '/account'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
const refreshUser = vi.fn()
const auth: { user: any; refreshUser: () => Promise<void> } = { user: null, refreshUser }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))

import PolicyConsentGate from '@/components/PolicyConsentGate'

describe('PolicyConsentGate', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    pathname = '/account'
    auth.user = { requiresPolicyAcceptance: true, policyVersion: 3, policiesAcceptedVersion: null, isBusiness: false }
    refreshUser.mockResolvedValue(undefined)
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('stays hidden for signed-out users, accepted users and legal pages', () => {
    auth.user = null
    const { container, rerender } = render(<PolicyConsentGate />)
    expect(container).toBeEmptyDOMElement()
    auth.user = { requiresPolicyAcceptance: false }
    rerender(<PolicyConsentGate />)
    expect(container).toBeEmptyDOMElement()
    auth.user = { requiresPolicyAcceptance: true }
    pathname = '/legal/privacy-policy'
    rerender(<PolicyConsentGate />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows first-time copy with the policy links and a disabled button until ticked', () => {
    render(<PolicyConsentGate />)
    expect(screen.getByText('Please review our policies')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy-policy')
    expect(screen.getByText(/Customer storefront/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept and continue' })).toBeDisabled()
  })

  it('shows the updated-policies copy for a returning user', () => {
    auth.user = { ...auth.user, policiesAcceptedVersion: 2 }
    render(<PolicyConsentGate />)
    expect(screen.getByText('Our policies have been updated')).toBeInTheDocument()
  })

  it('records acceptance with the business portal header and refreshes the user', async () => {
    auth.user = { ...auth.user, isBusiness: true }
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<PolicyConsentGate />)
    expect(screen.getByText(/Business portal/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }))
    await waitFor(() => expect(refreshUser).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/user/accept-policies')
    expect(init.headers['X-Auth-Portal']).toBe('business')
    expect(JSON.parse(init.body)).toEqual({ version: 3 })
  })

  it('shows the server error and a network error', async () => {
    render(<PolicyConsentGate />)
    fireEvent.click(screen.getByRole('checkbox'))
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Version mismatch' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }))
    expect(await screen.findByText('Version mismatch')).toBeInTheDocument()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }))
    expect(await screen.findByText('Network error. Please try again.')).toBeInTheDocument()
    expect(refreshUser).not.toHaveBeenCalled()
  })
})

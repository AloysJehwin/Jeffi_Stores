import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const replace = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

const useAuthMock = vi.fn<(...a: any[]) => any>()
const logout = vi.fn<(...a: any[]) => any>(() => Promise.resolve())
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))

const prompt = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ usePrompt: () => prompt }))

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import AccountDeletionPanel from '@/components/visitor/account/AccountDeletionPanel'

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)

describe('AccountDeletionPanel (render + branches + flow)', () => {
  beforeEach(() => {
    replace.mockReset()
    logout.mockReset().mockResolvedValue(undefined)
    showToast.mockReset()
    prompt.mockReset()
  })

  it('renders nothing while auth is loading', () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: true, logout })
    const { container } = render(<AccountDeletionPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a sign-in prompt with the redirect link when logged out', () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false, logout })
    render(<AccountDeletionPanel />)
    expect(screen.getByText(/To delete your account/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'sign in' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Flegal%2Faccount-deletion'
    )
  })

  it('shows the signed-in email and the delete button when authenticated', () => {
    useAuthMock.mockReturnValue({ user: { email: 'a@b.com' }, isLoading: false, logout })
    render(<AccountDeletionPanel />)
    expect(screen.getByText(/Signed in as a@b.com/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeInTheDocument()
  })

  it('lists blockers from the pre-check and does not prompt', async () => {
    useAuthMock.mockReturnValue({ user: { email: 'a@b.com' }, isLoading: false, logout })
    vi.stubGlobal('fetch', vi.fn(() => okJson({ blockers: [{ message: 'You have an open order' }] })))
    render(<AccountDeletionPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect(await screen.findByText('You have an open order')).toBeInTheDocument()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('deletes, toasts success, logs out and redirects home on a confirmed flow', async () => {
    useAuthMock.mockReturnValue({ user: { email: 'a@b.com' }, isLoading: false, logout })
    prompt.mockResolvedValue('DELETE')
    const fetchMock = vi
      .fn<(...a: any[]) => any>()
      .mockImplementationOnce(() => okJson({ blockers: [], retainedOrders: 0 }))
      .mockImplementationOnce(() => okJson({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AccountDeletionPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Your account has been deleted', 'success'))
    expect(logout).toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/')
    // POST body carries the DELETE confirmation.
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/account/delete',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) })
    )
  })

  it('warns and aborts when the typed confirmation is wrong', async () => {
    useAuthMock.mockReturnValue({ user: { email: 'a@b.com' }, isLoading: false, logout })
    prompt.mockResolvedValue('delete')
    vi.stubGlobal('fetch', vi.fn(() => okJson({ blockers: [], retainedOrders: 0 })))
    render(<AccountDeletionPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Type DELETE in capitals to confirm', 'error'))
    expect(replace).not.toHaveBeenCalled()
  })
})

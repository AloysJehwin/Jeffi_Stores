import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))

const useAuthMock = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

import UserMenu from '@/components/visitor/UserMenu'

const logout = vi.fn<(...a: any[]) => any>()
const user = (over: Record<string, any> = {}) => ({
  firstName: 'Asha',
  lastName: 'Rao',
  email: 'asha@example.com',
  avatarUrl: null,
  ...over,
})

describe('UserMenu (render + branches)', () => {
  beforeEach(() => {
    useAuthMock.mockReset()
    logout.mockReset()
  })

  it('renders a Login link when logged out', () => {
    useAuthMock.mockReturnValue({ user: null, logout })
    render(<UserMenu />)
    const link = screen.getByRole('link', { name: 'Login' })
    expect(link).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('renders the avatar initials button when logged in', () => {
    useAuthMock.mockReturnValue({ user: user(), logout })
    render(<UserMenu />)
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveAttribute('aria-expanded', 'false')
    // Initials from first + last name.
    expect(screen.getAllByText('AR').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the avatar image when avatarUrl is present', () => {
    useAuthMock.mockReturnValue({ user: user({ avatarUrl: '/me.png' }), logout })
    render(<UserMenu />)
    const imgs = screen.getAllByAltText('Asha') as HTMLImageElement[]
    expect(imgs[0]).toHaveAttribute('src', '/me.png')
  })

  it('opens the dropdown with account links and the email on click', () => {
    useAuthMock.mockReturnValue({ user: user(), logout })
    render(<UserMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('asha@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My Account' })).toHaveAttribute('href', '/account')
    expect(screen.getByRole('link', { name: 'My Orders' })).toHaveAttribute('href', '/account/orders')
    expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute('href', '/wishlist')
  })

  it('calls logout and closes the menu from the Logout button', () => {
    useAuthMock.mockReturnValue({ user: user(), logout })
    render(<UserMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(logout).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('asha@example.com')).not.toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { StoreAuthSkeleton, BusinessAuthSkeleton } from '@/components/visitor/skeletons/auth'

describe('StoreAuthSkeleton', () => {
  it('login is a busy status labelled "Loading login"', () => {
    render(<StoreAuthSkeleton kind="login" />)
    const s = screen.getByRole('status', { name: 'Loading login' })
    expect(s).toHaveAttribute('aria-busy', 'true')
    expect(s.querySelectorAll('.sk').length).toBeGreaterThan(0)
  })

  it('signup is labelled "Loading sign up" and carries different copy from login', () => {
    const login = render(<StoreAuthSkeleton kind="login" />)
    const loginText = login.container.textContent
    login.unmount()
    const signup = render(<StoreAuthSkeleton kind="signup" />)
    expect(screen.getByRole('status', { name: 'Loading sign up' })).toBeInTheDocument()
    expect(signup.container.textContent).not.toBe(loginText)
  })
})

describe('BusinessAuthSkeleton', () => {
  it('signin shows its real headline, corner links and selling points', () => {
    render(<BusinessAuthSkeleton kind="signin" />)
    const s = screen.getByRole('status')
    expect(s).toHaveAttribute('aria-busy', 'true')
    expect(s.getAttribute('aria-label')).toMatch(/^Loading /)
    expect(screen.getByRole('heading', { level: 2 }).textContent!.length).toBeGreaterThan(5)
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('signup carries a different label from signin', () => {
    const a = render(<BusinessAuthSkeleton kind="signin" />)
    const signinLabel = screen.getByRole('status').getAttribute('aria-label')
    a.unmount()
    render(<BusinessAuthSkeleton kind="signup" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).not.toBe(signinLabel)
  })
})

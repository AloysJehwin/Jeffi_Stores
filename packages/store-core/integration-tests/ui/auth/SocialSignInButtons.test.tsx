import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { SignInMethod } from '@/lib/auth/social/types'

// One button per enabled sign-in method (from /api/auth/methods). The module caches the method list
// at module scope, so each test re-imports the component fresh (vi.resetModules) with its own mocked
// fetch to control that list. google_platform calls back into the page; the rest leave via
// window.location.assign.

function mockFetch(methods: SignInMethod[] | 'error') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (methods === 'error') return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => ({ providers: methods }) }
    }) as unknown as typeof fetch
  )
}

async function load() {
  vi.resetModules()
  const mod = await import('@/components/auth/SocialSignInButtons')
  return mod.default
}

const baseProps = {
  portal: 'store' as const,
  onGooglePlatform: () => {},
}

beforeEach(() => {
  // Fresh window.location.assign spy each test.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: vi.fn() },
  })
})

afterEach(() => {
  cleanup()
})

describe('SocialSignInButtons (render + interaction)', () => {
  it('shows a pulse placeholder while methods are loading, then the buttons', async () => {
    mockFetch([{ id: 'google', label: 'Google', flow: 'redirect' }])
    const Buttons = await load()
    const { container } = render(<Buttons {...baseProps}>child</Buttons>)
    // Before the fetch resolves: a single skeleton with the children already present.
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.getByText('child')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument()
    )
  })

  it('renders nothing (but keeps children) when the store offers no methods', async () => {
    mockFetch([])
    const Buttons = await load()
    render(<Buttons {...baseProps}>divider</Buttons>)
    await waitFor(() => expect(screen.getByText('divider')).toBeInTheDocument())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('uses the custom verb in the stacked (<=2 methods) layout', async () => {
    mockFetch([
      { id: 'google', label: 'Google', flow: 'redirect' },
      { id: 'apple', label: 'Apple', flow: 'redirect' },
    ])
    const Buttons = await load()
    render(<Buttons {...baseProps} verb="Sign in with" />)
    await waitFor(() => expect(screen.getByText('Sign in with Google')).toBeInTheDocument())
    expect(screen.getByText('Sign in with Apple')).toBeInTheDocument()
  })

  it('leaves for the provider start URL on a redirect method', async () => {
    mockFetch([{ id: 'github', label: 'GitHub', flow: 'redirect' }])
    const Buttons = await load()
    render(<Buttons {...baseProps} redirect="/account" />)
    const btn = await screen.findByRole('button', { name: /Continue with GitHub/ })
    fireEvent.click(btn)
    expect(window.location.assign).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/oauth/github/start?')
    )
    expect(window.location.assign).toHaveBeenCalledWith(expect.stringContaining('redirect=%2Faccount'))
  })

  it('calls onGooglePlatform (not a redirect) for the google_platform flow', async () => {
    mockFetch([{ id: 'google', label: 'Google', flow: 'google_platform' }])
    const onGooglePlatform = vi.fn()
    const Buttons = await load()
    render(<Buttons {...baseProps} onGooglePlatform={onGooglePlatform} />)
    const btn = await screen.findByRole('button', { name: /Continue with Google/ })
    fireEvent.click(btn)
    expect(onGooglePlatform).toHaveBeenCalledOnce()
    expect(window.location.assign).not.toHaveBeenCalled()
  })

  it('shows the busy label on the google_platform button when googleBusy', async () => {
    mockFetch([{ id: 'google', label: 'Google', flow: 'google_platform' }])
    const Buttons = await load()
    render(<Buttons {...baseProps} googleBusy busyLabel="Working…" />)
    await waitFor(() => expect(screen.getByText('Working…')).toBeInTheDocument())
  })

  it('renders first-wide + icon grid for three or more methods, with aria-labels', async () => {
    mockFetch([
      { id: 'google', label: 'Google', flow: 'redirect' },
      { id: 'facebook', label: 'Facebook', flow: 'redirect' },
      { id: 'apple', label: 'Apple', flow: 'redirect' },
    ])
    const Buttons = await load()
    render(<Buttons {...baseProps} />)
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument())
    // The non-first buttons carry an aria-label of "verb label".
    expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument()
  })

  it('renders nothing when the methods fetch errors (treated as empty)', async () => {
    mockFetch('error')
    const Buttons = await load()
    render(<Buttons {...baseProps}>divider</Buttons>)
    await waitFor(() => expect(screen.getByText('divider')).toBeInTheDocument())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

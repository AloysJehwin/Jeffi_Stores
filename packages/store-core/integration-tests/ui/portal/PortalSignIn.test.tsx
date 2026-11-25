import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

const consumeGoogleRedirect = vi.fn<(...a: any[]) => any>()
const openGoogleOAuthPopup = vi.fn<(...a: any[]) => any>()
vi.mock('@/lib/client/google-oauth-popup', () => ({
  consumeGoogleRedirect: () => consumeGoogleRedirect(),
  openGoogleOAuthPopup: (o: any) => openGoogleOAuthPopup(o),
}))

import PortalSignIn from '@/components/portal/PortalSignIn'

const config: any = {
  successHref: '/portal/home',
  auth: { google: '/api/g', otpStart: '/api/otp/start', otpVerify: '/api/otp/verify' },
  signIn: { heading: 'Welcome back', description: 'Sign in to continue', emailHint: 'you@example.com', footnote: 'Staff only' },
}

// Lets the mount-time dynamic import of the (mocked) popup module finish before the user clicks.
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const json =(status: number, body: any) => new Response(JSON.stringify(body), { status })

describe('PortalSignIn', () => {
  beforeEach(() => {
    consumeGoogleRedirect.mockReturnValue(null)
    vi.stubGlobal('fetch', vi.fn())
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  })

  it('shows the surface copy, google button and email form', () => {
    render(<PortalSignIn config={config} />)
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument()
    expect(screen.getByText('Staff only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeDisabled()
  })

  it('sends a code, then verifies it and routes to the success page', async () => {
    const f = vi.mocked(fetch)
    f.mockResolvedValueOnce(json(200, { nextCooldown: 30 })).mockResolvedValueOnce(json(200, {}))
    render(<PortalSignIn config={config} />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: ' a@b.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    expect(await screen.findByText('a@b.com')).toBeInTheDocument()
    expect(JSON.parse((f.mock.calls[0][1] as any).body)).toEqual({ email: 'a@b.com' })
    expect(screen.getByRole('button', { name: /Resend in/ })).toBeDisabled()

    const code = screen.getByPlaceholderText('123456')
    fireEvent.change(code, { target: { value: '12ab34c56' } })
    expect(code).toHaveValue('123456')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/portal/home'))
    expect(JSON.parse((f.mock.calls[1][1] as any).body)).toEqual({ email: 'a@b.com', code: '123456' })
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the server error and cooldown when the code cannot be sent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(429, { error: 'Too many tries', retryAfter: 45 }))
    render(<PortalSignIn config={config} />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    expect(await screen.findByText('Too many tries')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeInTheDocument()
  })

  it('shows an invalid-code error and can go back to the first step', async () => {
    const f = vi.mocked(fetch)
    f.mockResolvedValueOnce(json(200, {})).mockResolvedValueOnce(json(400, { error: 'Wrong code' }))
    render(<PortalSignIn config={config} />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    fireEvent.change(await screen.findByPlaceholderText('123456'), { target: { value: '111111' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Wrong code')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeInTheDocument()
    expect(screen.queryByText('Wrong code')).toBeNull()
  })

  it('explains when google sign-in is not configured', async () => {
    render(<PortalSignIn config={config} />)
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
    expect(await screen.findByText(/Google sign-in is not configured/)).toBeInTheDocument()
  })

  it('signs in through the google popup and reports a failed exchange', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'cid'
    openGoogleOAuthPopup.mockResolvedValueOnce({ accessToken: 'tok' }).mockResolvedValueOnce({ accessToken: 'tok2' })
    vi.mocked(fetch).mockResolvedValueOnce(json(200, {})).mockResolvedValueOnce(json(403, { error: 'Not allowed' }))
    render(<PortalSignIn config={config} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/portal/home'))
    expect(openGoogleOAuthPopup).toHaveBeenCalledWith({ clientId: 'cid' })

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
    expect(await screen.findByText('Not allowed')).toBeInTheDocument()
  })

  it('stays quiet when the popup is closed but shows other popup errors', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'cid'
    openGoogleOAuthPopup.mockResolvedValueOnce({ error: 'popup_closed' }).mockResolvedValueOnce({ error: 'access_denied' })
    render(<PortalSignIn config={config} />)
    await settle()
    const btn = () => screen.getByRole('button', { name: /Continue with Google|Signing in/ })
    fireEvent.click(btn())
    await waitFor(() => expect(openGoogleOAuthPopup).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(btn()).not.toBeDisabled())
    expect(screen.queryByText('popup_closed')).toBeNull()
    fireEvent.click(btn())
    expect(await screen.findByText('access_denied')).toBeInTheDocument()
  })

  it('completes a google redirect that returned to the page', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'cid'
    consumeGoogleRedirect.mockReturnValue({ accessToken: 'back' })
    vi.mocked(fetch).mockResolvedValueOnce(json(200, {}))
    render(<PortalSignIn config={config} />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/portal/home'))
    expect(openGoogleOAuthPopup).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const routerPush = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush, replace: vi.fn() }), useSearchParams: () => params }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let channels = { sms: true, whatsapp: true }
vi.mock('@/hooks/useStoreFlags', () => ({ useMessagingChannels: () => channels }))
const auth = { user: null as any, isLoading: false, login: vi.fn(), googleLoginWithAccessToken: vi.fn(), logout: vi.fn() }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const refreshCart = vi.fn()
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ refreshCart }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Halo' } }) }))
const openGoogleOAuthPopup = vi.fn()
vi.mock('@/lib/client/google-oauth-popup', () => ({ openGoogleOAuthPopup: (...a: any[]) => openGoogleOAuthPopup(...a) }))
const go = vi.fn()
vi.mock('@/components/auth/useLeaveTo', () => ({ useLeaveTo: () => ({ leaving: false, go }) }))
vi.mock('@/components/visitor/PhoneVerifyModal', () => ({
  default: ({ title, requiresPolicy, onVerified, onCancel }: any) => (
    <div role="dialog" aria-label="phone modal">
      {`${title ?? 'default'}:${requiresPolicy}`}
      <button onClick={onVerified}>verified</button>
      <button onClick={onCancel}>cancelled</button>
    </div>
  ),
}))
vi.mock('@/components/visitor/skeletons/auth', () => ({ StoreAuthSkeleton: () => <div>skeleton</div> }))
vi.mock('@/components/auth/SocialSignInButtons', () => ({
  default: ({ onGooglePlatform, googleBusy, children }: any) => (
    <div>
      <button onClick={onGooglePlatform} disabled={googleBusy}>Google</button>
      {children}
    </div>
  ),
}))

import LoginClient from '@storefront/app/(auth)/login/LoginClient'

const fetchMock = vi.fn()
const res = (data: any, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => data })
const calls = (path: string) => fetchMock.mock.calls.filter(c => c[0] === path)

async function toOtp(identifier = 'asha@x.test', data: any = {}) {
  fetchMock.mockResolvedValueOnce(res(data))
  fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: identifier } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByLabelText('Verification Code')
}

describe('LoginClient', () => {
  beforeEach(() => {
    for (const m of [routerPush, go, refreshCart, showToast, openGoogleOAuthPopup, auth.login, auth.googleLoginWithAccessToken, auth.logout, fetchMock]) m.mockReset()
    params = new URLSearchParams()
    auth.user = null
    auth.isLoading = false
    channels = { sms: true, whatsapp: true }
    window.history.replaceState(null, '', '/login')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'gid')
  })

  it('shows the welcome card with the store name, channel choices and a signup link', () => {
    render(<LoginClient />)
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument()
    expect(screen.getByText('Login to your Halo account')).toBeInTheDocument()
    for (const c of ['Email', 'SMS', 'WhatsApp']) expect(screen.getByRole('button', { name: c })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/signup')
  })

  it('hides switched-off channels and the heading when bare', () => {
    channels = { sms: false, whatsapp: false }
    render(<LoginClient bare />)
    expect(screen.queryByRole('button', { name: 'SMS' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'WhatsApp' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Welcome Back' })).not.toBeInTheDocument()
  })

  it('keeps a safe redirect in the signup link and ignores a redirect back to auth pages', () => {
    params = new URLSearchParams('redirect=/cart')
    const a = render(<LoginClient />)
    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/signup?redirect=%2Fcart')
    a.unmount()
    params = new URLSearchParams('redirect=/login')
    render(<LoginClient />)
    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/signup')
  })

  it('shows a provider error from the URL', () => {
    params = new URLSearchParams('oauth_error=failed')
    render(<LoginClient />)
    expect(screen.getByText(/sign-in|try again|failed/i)).toBeInTheDocument()
  })

  it('redirects a signed-in user straight away', () => {
    auth.user = { id: 'u1', phone: '1', phoneVerified: true }
    params = new URLSearchParams('redirect=/account')
    render(<LoginClient />)
    expect(go).toHaveBeenCalledWith('/account', 'replace')
  })

  it('validates the identifier and a phone number before sending', () => {
    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: '98765' } })
    fireEvent.submit(screen.getByLabelText('Email or Mobile Number').closest('form')!)
    expect(screen.getByText('Enter a valid 10-digit mobile number')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('SMS/WhatsApp with an email asks for a mobile number first', () => {
    render(<LoginClient />)
    fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: 'asha@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }))
    expect(screen.getByLabelText('Mobile Number')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mobile Number'), { target: { value: '12' } })
    expect(screen.getByText('Enter a valid 10-digit mobile number')).toBeInTheDocument()
    fireEvent.submit(screen.getByLabelText('Email or Mobile Number').closest('form')!)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the OTP for an email and shows the code step', async () => {
    render(<LoginClient />)
    await toOtp('asha@x.test', { resolvedEmail: 'asha@x.test', nextCooldown: 45 })
    expect(JSON.parse(calls('/api/auth/send-otp')[0][1].body)).toEqual({ identifier: 'asha@x.test', phone: undefined, channel: 'email', isSignup: false })
    expect(screen.getByText(/verification code to/)).toHaveTextContent('asha@x.test')
    expect(screen.getByRole('button', { name: 'Resend in 45s' })).toBeDisabled()
  })

  it('a phone identifier receives the OTP on that number, shown masked', async () => {
    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }))
    await toOtp('9876543210', { resolvedEmail: 'asha@x.test' })
    expect(JSON.parse(calls('/api/auth/send-otp')[0][1].body)).toMatchObject({ phone: '+919876543210', channel: 'whatsapp' })
    expect(screen.getByText(/via WhatsApp to/)).toHaveTextContent('+91 ••••• 3210')
  })

  it('an unknown email is sent to signup with it prefilled', async () => {
    render(<LoginClient />)
    fetchMock.mockResolvedValueOnce(res({ userNotFound: true }, false, 404))
    fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: 'new@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/signup?email=new%40x.test&from=login'))
  })

  it('an unknown phone goes to signup, keeping the redirect', async () => {
    params = new URLSearchParams('redirect=/cart')
    render(<LoginClient />)
    fetchMock.mockResolvedValueOnce(res({ userNotFound: true }, false, 404))
    fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/signup?from=login&redirect=%2Fcart'))
  })

  it('shows a send failure, and a 429 moves to the code step with the cooldown', async () => {
    render(<LoginClient />)
    fetchMock.mockResolvedValueOnce(res({ error: 'Too many requests', retryAfter: 60 }, false, 429))
    fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: 'a@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Too many requests')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend in 60s' })).toBeInTheDocument()
  })

  it('a full code logs in automatically, refreshes the cart, saves the channel and leaves', async () => {
    params = new URLSearchParams('redirect=/account')
    auth.login.mockResolvedValue(undefined)
    render(<LoginClient />)
    await toOtp('asha@x.test', { resolvedEmail: 'asha@x.test' })
    fetchMock.mockResolvedValue(res({}))
    fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '12a3456' } })
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('asha@x.test', '123456', undefined))
    await waitFor(() => expect(go).toHaveBeenCalledWith('/account'))
    expect(refreshCart).toHaveBeenCalled()
    expect(JSON.parse(calls('/api/user/update')[0][1].body)).toEqual({ notificationChannel: 'email' })
  })

  it('a wrong code shows the error and clears the field for another try', async () => {
    auth.login.mockRejectedValue(new Error('Invalid code'))
    render(<LoginClient />)
    await toOtp('asha@x.test', { resolvedEmail: 'asha@x.test' })
    fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '000000' } })
    expect(await screen.findByText('Invalid code')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Verification Code')).toHaveValue(''))
    expect(go).not.toHaveBeenCalled()
  })

  it('a first-time user must accept the policies before the code is submitted', async () => {
    auth.login.mockResolvedValue(undefined)
    fetchMock.mockResolvedValue(res({}))
    render(<LoginClient />)
    await toOtp('asha@x.test', { resolvedEmail: 'asha@x.test', requiresPolicyAcceptance: true })
    fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '123456' } })
    expect(screen.getByRole('button', { name: 'Login' })).toBeDisabled()
    expect(auth.login).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('asha@x.test', '123456', true))
  })

  it('resend sends a new code and toasts; Change Channel goes back', async () => {
    render(<LoginClient />)
    await toOtp('asha@x.test', { resolvedEmail: 'asha@x.test', nextCooldown: 0 })
    fetchMock.mockResolvedValueOnce(res({ nextCooldown: 60 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Resend Code' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('New OTP sent! Check your inbox for the latest code.', 'success'))
    fireEvent.click(screen.getByRole('button', { name: 'Change Channel' }))
    expect(screen.getByLabelText('Email or Mobile Number')).toBeInTheDocument()
  })

  it('Google: a missing client id is reported', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '')
    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    expect(await screen.findByText('Google sign-in is not configured')).toBeInTheDocument()
  })

  it('Google: a closed popup is silent, other popup errors show', async () => {
    render(<LoginClient />)
    openGoogleOAuthPopup.mockResolvedValueOnce({ error: 'popup_closed' })
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    await waitFor(() => expect(openGoogleOAuthPopup).toHaveBeenCalledWith({ clientId: 'gid', returnTo: '/login' }))
    expect(screen.queryByText('popup_closed')).not.toBeInTheDocument()
    openGoogleOAuthPopup.mockResolvedValueOnce({ error: 'access_denied' })
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    expect(await screen.findByText('access_denied')).toBeInTheDocument()
  })

  it('Google: an existing user with a verified phone is logged in and redirected', async () => {
    openGoogleOAuthPopup.mockResolvedValue({ accessToken: 'tok' })
    auth.googleLoginWithAccessToken.mockResolvedValue({ user: { phone: '1', phoneVerified: true } })
    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'))
    expect(refreshCart).toHaveBeenCalled()
  })

  it('Google: a user missing a verified phone is asked for one, and Cancel signs them out', async () => {
    openGoogleOAuthPopup.mockResolvedValue({ accessToken: 'tok' })
    auth.googleLoginWithAccessToken.mockResolvedValue({ user: { phone: null, phoneVerified: false, requiresPolicyAcceptance: true } })
    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    expect(await screen.findByRole('dialog', { name: 'phone modal' })).toHaveTextContent('Almost there:true')
    fireEvent.click(screen.getByRole('button', { name: 'cancelled' }))
    expect(auth.logout).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Google: finishing the phone step redirects', async () => {
    openGoogleOAuthPopup.mockResolvedValue({ accessToken: 'tok' })
    auth.googleLoginWithAccessToken.mockResolvedValue({ user: { phone: null } })
    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    await screen.findByRole('dialog', { name: 'phone modal' })
    fireEvent.click(screen.getByRole('button', { name: 'verified' }))
    expect(go).toHaveBeenCalledWith('/')
  })

  it('Google: a new user is sent to signup with the token kept in sessionStorage, not the URL', async () => {
    openGoogleOAuthPopup.mockResolvedValue({ accessToken: 'tok' })
    auth.googleLoginWithAccessToken.mockResolvedValue({ newUser: true, profile: { email: 'a@x.test', firstName: 'A', lastName: 'B' } })
    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('/signup?google=1&from=login'))
    expect(JSON.parse(sessionStorage.getItem('google_signup')!)).toEqual({ accessToken: 'tok', profile: { email: 'a@x.test', firstName: 'A', lastName: 'B' } })
  })

  it('Google: a login failure shows its message', async () => {
    openGoogleOAuthPopup.mockResolvedValue({ accessToken: 'tok' })
    auth.googleLoginWithAccessToken.mockRejectedValue(new Error('Account disabled'))
    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    expect(await screen.findByText('Account disabled')).toBeInTheDocument()
  })

  it('picks up a Google token from the URL hash (popup was blocked) and signs in', async () => {
    window.history.replaceState(null, '', '/login#access_token=hashtok')
    auth.googleLoginWithAccessToken.mockResolvedValue({ user: { phone: '1', phoneVerified: true } })
    render(<LoginClient />)
    await waitFor(() => expect(auth.googleLoginWithAccessToken).toHaveBeenCalledWith('hashtok'))
    expect(window.location.hash).toBe('')
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'))
  })

  it('a Google error in the hash shows a failure message', async () => {
    window.history.replaceState(null, '', '/login#error=access_denied')
    render(<LoginClient />)
    expect(await screen.findByText('Google sign-in failed. Please try again.')).toBeInTheDocument()
    expect(auth.googleLoginWithAccessToken).not.toHaveBeenCalled()
  })

  it('back from a provider sign-in (?oauth=done) with no verified phone opens the phone step instead of leaving', () => {
    params = new URLSearchParams('oauth=done')
    auth.user = { id: 'u1', phone: null, phoneVerified: false }
    render(<LoginClient />)
    expect(screen.getByRole('dialog', { name: 'phone modal' })).toBeInTheDocument()
    expect(go).not.toHaveBeenCalled()
  })
})

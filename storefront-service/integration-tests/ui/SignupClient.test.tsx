import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => params }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let channels = { sms: true, whatsapp: true }
vi.mock('@/hooks/useStoreFlags', () => ({ useMessagingChannels: () => channels }))
const auth = { signup: vi.fn(), googleLoginWithAccessToken: vi.fn(), googleSignupComplete: vi.fn(), logout: vi.fn(), refreshUser: vi.fn() }
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
  default: ({ title, requiresPolicy, requiresDob, abandonOnCancel, onVerified, onCancel }: any) => (
    <div role="dialog" aria-label="phone modal">
      {`${title ?? 'default'}|policy:${!!requiresPolicy}|dob:${!!requiresDob}|abandon:${!!abandonOnCancel}`}
      <button onClick={onVerified}>verified</button>
      <button onClick={onCancel}>cancelled</button>
    </div>
  ),
}))
vi.mock('@/components/visitor/skeletons/auth', () => ({ StoreAuthSkeleton: () => <div>skeleton</div> }))
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({ value, onChange }: any) => <input aria-label="Date of birth" value={value} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@/components/auth/OAuthEmailField', () => ({
  default: ({ email, onEmail, onVerified }: any) => (
    <div>
      <input aria-label="oauth email" value={email} onChange={e => onEmail(e.target.value)} />
      <button onClick={() => onVerified(true)}>verify email</button>
    </div>
  ),
}))
vi.mock('@/components/auth/SocialSignInButtons', () => ({
  default: ({ onGooglePlatform, verb, children }: any) => (
    <div>
      <button onClick={onGooglePlatform}>{`${verb} Google`}</button>
      {children}
    </div>
  ),
}))

import SignupClient from '@storefront/app/(auth)/signup/SignupClient'

const fetchMock = vi.fn()
const res = (data: any, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => data })
const calls = (path: string) => fetchMock.mock.calls.filter(c => c[0] === path)
const field = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

function fillDetails(over: { first?: string; phone?: string; email?: string; dob?: string } = {}) {
  field(/First Name/, over.first ?? 'Asha')
  field(/Email Address/, over.email ?? 'asha@x.test')
  field(/Mobile Number/, over.phone ?? '9876543210')
  field('Date of birth', over.dob ?? '1990-05-17')
}
async function toOtp(cfg: Record<string, any> = {}) {
  fetchMock.mockResolvedValueOnce(res(cfg))
  fillDetails()
  fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }))
  await screen.findByLabelText('Verification Code')
}

describe('SignupClient', () => {
  beforeEach(() => {
    for (const m of [...Object.values(auth), go, refreshCart, showToast, openGoogleOAuthPopup, fetchMock]) m.mockReset()
    fetchMock.mockImplementation(async (url: string) => (url === '/api/referrals/lookup' ? res({}) : res({})))
    params = new URLSearchParams()
    channels = { sms: true, whatsapp: true }
    window.history.replaceState(null, '', '/signup')
    sessionStorage.clear()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'gid')
  })

  it('shows the details form with a login link, channel options needing a phone, and the social button', () => {
    render(<SignupClient />)
    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Login here' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign up with Google' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SMS' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toBeDisabled()
    field(/Mobile Number/, '9876543210')
    expect(screen.getByRole('button', { name: 'SMS' })).toBeEnabled()
  })

  it('drops switched-off channels and the heading when bare', () => {
    channels = { sms: false, whatsapp: false }
    render(<SignupClient bare />)
    expect(screen.queryByRole('button', { name: 'SMS' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Create Account' })).not.toBeInTheDocument()
  })

  it('mentions the friend who referred the visitor', async () => {
    fetchMock.mockImplementation(async () => res({ firstName: 'Ravi' }))
    render(<SignupClient />)
    expect(await screen.findByText('Ravi invited you to Halo.')).toBeInTheDocument()
  })

  it('arriving from login shows the "no account" notice with the email prefilled', () => {
    params = new URLSearchParams('from=login&email=new%40x.test')
    render(<SignupClient />)
    expect(screen.getByText(/No account found for/)).toHaveTextContent('new@x.test')
    expect(screen.getByLabelText(/Email Address/)).toHaveValue('new@x.test')
  })

  it('validates name, phone length and date of birth before sending a code', () => {
    render(<SignupClient />)
    const submit = () => fireEvent.submit(screen.getByLabelText(/First Name/).closest('form')!)
    field(/Email Address/, 'a@x.test')
    field(/First Name/, '   ')
    submit()
    expect(screen.getByText('First name is required')).toBeInTheDocument()
    field(/First Name/, 'Asha')
    field(/Mobile Number/, '123')
    submit()
    expect(screen.getByText('Enter a valid 10-digit mobile number', { selector: 'div' })).toBeInTheDocument()
    field(/Mobile Number/, '')
    field('Date of birth', '2999-01-01')
    submit()
    expect(screen.getByText('Enter a valid date of birth', { selector: 'div' })).toBeInTheDocument()
    expect(calls('/api/auth/send-otp')).toHaveLength(0)
  })

  it('sends the OTP with the chosen channel and phone, then shows the code step', async () => {
    render(<SignupClient />)
    fillDetails()
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }))
    fetchMock.mockResolvedValueOnce(res({ nextCooldown: 40 }))
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }))
    await screen.findByLabelText('Verification Code')
    expect(JSON.parse(calls('/api/auth/send-otp')[0][1].body)).toEqual({ email: 'asha@x.test', isSignup: true, channel: 'whatsapp', phone: '+919876543210' })
    expect(screen.getByText(/verification code to/)).toHaveTextContent('+91 ••••• 3210')
    expect(screen.getByRole('button', { name: 'Resend in 40s' })).toBeDisabled()
  })

  it('clearing the phone puts the channel back to email', () => {
    render(<SignupClient />)
    field(/Mobile Number/, '9876543210')
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }))
    expect(screen.getByRole('button', { name: 'SMS' }).className).toContain('border-accent-500')
    field(/Mobile Number/, '')
    expect(screen.getByRole('button', { name: 'Email' }).className).toContain('border-accent-500')
    expect(screen.getByRole('button', { name: 'SMS' })).toBeDisabled()
  })

  it('shows a send failure on the details step', async () => {
    render(<SignupClient />)
    fetchMock.mockResolvedValueOnce(res({ error: 'Email already registered' }, false))
    fillDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }))
    expect(await screen.findByText('Email already registered')).toBeInTheDocument()
    expect(screen.queryByLabelText('Verification Code')).not.toBeInTheDocument()
  })

  it('a 429 moves to the code step with the cooldown', async () => {
    render(<SignupClient />)
    fetchMock.mockResolvedValueOnce(res({ error: 'Slow down', retryAfter: 50 }, false, 429))
    fillDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }))
    expect(await screen.findByText('Slow down')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend in 50s' })).toBeInTheDocument()
  })

  it('verifies the code once the policies are accepted, creates the account and leaves', async () => {
    params = new URLSearchParams('redirect=/account')
    auth.signup.mockResolvedValue(undefined)
    render(<SignupClient />)
    await toOtp()
    fetchMock.mockResolvedValue(res({}))
    expect(screen.getByRole('button', { name: 'Verify & Create Account' })).toBeDisabled()
    field('Verification Code', '123456')
    expect(auth.signup).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(auth.signup).toHaveBeenCalled())
    expect(JSON.parse(calls('/api/auth/verify-otp')[0][1].body)).toEqual({ email: 'asha@x.test', otp: '123456' })
    expect(auth.signup).toHaveBeenCalledWith({
      email: 'asha@x.test', otp: '123456', firstName: 'Asha', lastName: undefined, phone: '+919876543210', dateOfBirth: '1990-05-17',
    })
    await waitFor(() => expect(go).toHaveBeenCalledWith('/account'))
    expect(refreshCart).toHaveBeenCalled()
  })

  it('an invalid code shows the error and clears the field', async () => {
    render(<SignupClient />)
    await toOtp()
    fireEvent.click(screen.getByRole('checkbox'))
    fetchMock.mockResolvedValueOnce(res({ error: 'Invalid OTP' }, false))
    field('Verification Code', '000000')
    expect(await screen.findByText('Invalid OTP')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Verification Code')).toHaveValue(''))
    expect(auth.signup).not.toHaveBeenCalled()
  })

  it('resend toasts, and Change details returns to the form', async () => {
    render(<SignupClient />)
    await toOtp({ nextCooldown: 0 })
    fetchMock.mockResolvedValueOnce(res({ nextCooldown: 60 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Resend Code' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('OTP sent successfully!', 'success'))
    fireEvent.click(screen.getByRole('button', { name: 'Change details' }))
    expect(screen.getByLabelText(/First Name/)).toBeInTheDocument()
  })

  it('Google: an existing user missing a phone, policy or DOB gets the verify modal asking for each', async () => {
    openGoogleOAuthPopup.mockResolvedValue({ accessToken: 'tok' })
    auth.googleLoginWithAccessToken.mockResolvedValue({ user: { phone: null, requiresPolicyAcceptance: true, dateOfBirth: null } })
    render(<SignupClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with Google' }))
    expect(await screen.findByRole('dialog', { name: 'phone modal' })).toHaveTextContent('Almost there|policy:true|dob:true|abandon:false')
    fireEvent.click(screen.getByRole('button', { name: 'cancelled' }))
    expect(auth.logout).toHaveBeenCalled()
  })

  it('Google: a complete existing user is redirected', async () => {
    openGoogleOAuthPopup.mockResolvedValue({ accessToken: 'tok' })
    auth.googleLoginWithAccessToken.mockResolvedValue({ user: { phone: '1', phoneVerified: true, dateOfBirth: '1990-05-17' } })
    render(<SignupClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with Google' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'))
  })

  it('Google: a new user gets the confirm-details form, which completes sign-up then verifies the phone', async () => {
    openGoogleOAuthPopup.mockResolvedValue({ accessToken: 'tok' })
    auth.googleLoginWithAccessToken.mockResolvedValue({ newUser: true, profile: { email: 'g@x.test', firstName: 'Gita', lastName: 'Rao' } })
    auth.googleSignupComplete.mockResolvedValue(undefined)
    render(<SignupClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with Google' }))
    expect(await screen.findByText(/No account found for/)).toHaveTextContent('g@x.test')
    expect(screen.getByLabelText('Email Address')).toBeDisabled()
    const go1 = screen.getByRole('button', { name: 'Continue' })
    expect(go1).toBeDisabled()
    field('First Name *', 'Gita')
    field(/Mobile Number/, '9876543210')
    field('Date of birth', '1990-05-17')
    fireEvent.click(screen.getByRole('checkbox'))
    expect(go1).toBeEnabled()
    fireEvent.click(go1)
    expect(await screen.findByRole('dialog', { name: 'phone modal' })).toHaveTextContent('Verify your mobile number|policy:false|dob:false|abandon:true')
    expect(auth.googleSignupComplete).toHaveBeenCalledWith({ accessToken: 'tok', firstName: 'Gita', lastName: 'Rao', phone: '+919876543210', dateOfBirth: '1990-05-17' })
    fireEvent.click(screen.getByRole('button', { name: 'verified' }))
    expect(go).toHaveBeenCalledWith('/')
  })

  it('Google sign-up session in sessionStorage prefills the form; a missing one reports expiry', () => {
    params = new URLSearchParams('google=1')
    sessionStorage.setItem('google_signup', JSON.stringify({ accessToken: 'tok', profile: { email: 'g@x.test', firstName: 'Gita', lastName: 'Rao' } }))
    const a = render(<SignupClient />)
    expect(screen.getByLabelText('First Name *')).toHaveValue('Gita')
    a.unmount()
    sessionStorage.clear()
    render(<SignupClient />)
    expect(screen.getByText('Google sign-up session expired. Please try again.')).toBeInTheDocument()
  })

  it('Google: a failed sign-up request shows its message', async () => {
    params = new URLSearchParams('google=1')
    sessionStorage.setItem('google_signup', JSON.stringify({ accessToken: 'tok', profile: { email: 'g@x.test', firstName: 'Gita', lastName: '' } }))
    auth.googleSignupComplete.mockRejectedValue(new Error('Phone already used'))
    render(<SignupClient />)
    field(/Mobile Number/, '9876543210')
    field('Date of birth', '1990-05-17')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Phone already used')).toBeInTheDocument()
  })

  it('Google: missing client id and non-silent popup errors are shown', async () => {
    const a = render(<SignupClient />)
    openGoogleOAuthPopup.mockResolvedValueOnce({ error: 'access_denied' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with Google' }))
    expect(await screen.findByText('access_denied')).toBeInTheDocument()
    a.unmount()
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '')
    render(<SignupClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with Google' }))
    expect(await screen.findByText('Google sign-in is not configured')).toBeInTheDocument()
  })

  it('back from another provider with no email: needs a verified email before it can finish', async () => {
    params = new URLSearchParams('oauth=facebook')
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/auth/oauth/pending'
        ? res({ pending: { provider: 'facebook', portal: 'store', needsEmail: true, profile: { email: '', firstName: 'Fay', lastName: '' } } })
        : url === '/api/auth/oauth/complete'
          ? res({})
          : res({})
    )
    auth.refreshUser.mockResolvedValue(undefined)
    render(<SignupClient />)
    expect(await screen.findByText(/did not share a verified email address/)).toBeInTheDocument()
    field(/Mobile Number/, '9876543210')
    field('Date of birth', '1990-05-17')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Verify your email address to continue')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('oauth email'), { target: { value: 'fay@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'verify email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(calls('/api/auth/oauth/complete')).toHaveLength(1))
    expect(JSON.parse(calls('/api/auth/oauth/complete')[0][1].body)).toMatchObject({ firstName: 'Fay', phone: '+919876543210', email: 'fay@x.test' })
    expect(auth.refreshUser).toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: 'phone modal' })).toBeInTheDocument()
  })

  it('an expired provider sign-up session shows an error', async () => {
    params = new URLSearchParams('oauth=facebook')
    fetchMock.mockImplementation(async (url: string) => (url === '/api/auth/oauth/pending' ? res({ pending: null }) : res({})))
    render(<SignupClient />)
    expect(await screen.findByText('Your sign-up session expired. Please try again.')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import OAuthEmailField from '@/components/auth/OAuthEmailField'

// Email proof for a social sign-up: type an address, "Send code", enter the 6-digit OTP. The
// component POSTs to /api/auth/send-otp and /api/auth/verify-otp — both are mocked here, no network.

function okFetch() {
  return vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch
}

beforeEach(() => {
  vi.stubGlobal('fetch', okFetch())
})

const base = {
  email: '',
  onEmail: () => {},
  verified: false,
  onVerified: () => {},
}

describe('OAuthEmailField (render)', () => {
  it('renders the email input, label and the helper line', () => {
    render(<OAuthEmailField {...base} />)
    expect(screen.getByLabelText('Email Address *')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
    expect(screen.getByText(/send a code to confirm/i)).toBeInTheDocument()
  })

  it('shows "Send code" and disables it when the email is empty', () => {
    render(<OAuthEmailField {...base} email="" />)
    const btn = screen.getByRole('button', { name: 'Send code' })
    expect(btn).toBeDisabled()
  })

  it('reports typed email upward and resets the sent state', () => {
    const onEmail = vi.fn()
    render(<OAuthEmailField {...base} onEmail={onEmail} />)
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), {
      target: { value: 'a@b.com' },
    })
    expect(onEmail).toHaveBeenCalledWith('a@b.com')
  })

  it('shows "Verified" and disables the input in the verified state', () => {
    render(<OAuthEmailField {...base} email="a@b.com" verified />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('your@email.com')).toBeDisabled()
    // No send button once verified.
    expect(screen.queryByRole('button', { name: /send|resend/i })).not.toBeInTheDocument()
  })

  it('rejects an invalid email locally before any request', () => {
    render(<OAuthEmailField {...base} email="not-an-email" />)
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends the OTP, reveals the code input and flips to "Resend"', async () => {
    render(<OAuthEmailField {...base} email="a@b.com" />)
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Email verification code')).toBeInTheDocument()
    )
    expect(fetch).toHaveBeenCalledWith('/api/auth/send-otp', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument()
  })

  it('verifies automatically once six digits are entered', async () => {
    const onVerified = vi.fn()
    render(<OAuthEmailField {...base} email="a@b.com" onVerified={onVerified} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    const codeInput = await screen.findByLabelText('Email verification code')
    fireEvent.change(codeInput, { target: { value: '123456' } })
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(true))
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/verify-otp',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('strips non-digits from the code and does not verify a short code', async () => {
    const onVerified = vi.fn()
    render(<OAuthEmailField {...base} email="a@b.com" onVerified={onVerified} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    const codeInput = (await screen.findByLabelText('Email verification code')) as HTMLInputElement
    fireEvent.change(codeInput, { target: { value: '12ab' } })
    expect(codeInput.value).toBe('12')
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('surfaces the server error message when sending fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Rate limited' }) })) as unknown as typeof fetch
    )
    render(<OAuthEmailField {...base} email="a@b.com" />)
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(screen.getByText('Rate limited')).toBeInTheDocument())
  })

  it('passes userType through to the send-otp body when given', async () => {
    const spy = okFetch()
    vi.stubGlobal('fetch', spy)
    render(<OAuthEmailField {...base} email="a@b.com" userType="business" />)
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
    const body = JSON.parse((spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body).toMatchObject({ email: 'a@b.com', isSignup: true, channel: 'email', userType: 'business' })
  })
})

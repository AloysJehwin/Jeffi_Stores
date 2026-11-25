import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const refreshUser = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ refreshUser }) }))
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({ value, onChange }: any) => <input aria-label="dob" value={value} onChange={e => onChange(e.target.value)} />,
}))

import PhoneVerifyModal from '@/components/visitor/PhoneVerifyModal'

const fetchMock = vi.fn()
const res = (data: any, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => data })
const calls = (path: string) => fetchMock.mock.calls.filter(c => c[0] === path)

function setup(props: Record<string, any> = {}) {
  const onVerified = vi.fn()
  const onCancel = vi.fn()
  render(<PhoneVerifyModal onVerified={onVerified} onCancel={onCancel} {...props} />)
  return { onVerified, onCancel }
}
const typePhone = (v: string) => fireEvent.change(screen.getByLabelText('Mobile Number *'), { target: { value: v } })
async function toOtpStage(data: any = { channel: 'whatsapp' }) {
  fetchMock.mockResolvedValueOnce(res(data))
  typePhone('9876543210')
  fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
  await screen.findByLabelText('Enter OTP *')
}

describe('PhoneVerifyModal', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    refreshUser.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.useRealTimers())

  it('starts on the phone stage with Send OTP disabled until 10 digits', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Add Mobile Number' })).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Send OTP' })
    expect(send).toBeDisabled()
    typePhone('98765')
    expect(screen.getByText('Enter a valid 10-digit mobile number')).toBeInTheDocument()
    typePhone('98765-43210abc')
    expect(screen.getByLabelText('Mobile Number *')).toHaveValue('9876543210')
    expect(send).toBeEnabled()
  })

  it('prefills the last 10 digits of the initial phone and honours a custom title', () => {
    setup({ initialPhone: '+91 98765 43210', title: 'Confirm your number' })
    expect(screen.getByLabelText('Mobile Number *')).toHaveValue('9876543210')
    expect(screen.getByRole('heading', { name: 'Confirm your number' })).toBeInTheDocument()
  })

  it('requires the policy checkbox when asked, and links the policies', () => {
    setup({ requiresPolicy: true })
    typePhone('9876543210')
    const send = screen.getByRole('button', { name: 'Send OTP' })
    expect(send).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy-policy')
    expect(screen.getByRole('link', { name: 'Terms & Conditions' })).toHaveAttribute('href', '/legal/terms-and-conditions')
    fireEvent.click(screen.getByRole('checkbox'))
    expect(send).toBeEnabled()
  })

  it('requires a valid date of birth when asked', () => {
    setup({ requiresDob: true })
    typePhone('9876543210')
    const send = screen.getByRole('button', { name: 'Send OTP' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('dob'), { target: { value: '1990-05-17' } })
    expect(send).toBeEnabled()
  })

  it('sends the OTP, then moves to the code stage and says where it went (WhatsApp)', async () => {
    setup()
    await toOtpStage({ channel: 'whatsapp', nextCooldown: 45 })
    expect(JSON.parse(calls('/api/auth/phone/send-otp')[0][1].body)).toEqual({ phone: '9876543210' })
    expect(screen.getByRole('heading', { name: 'Verify Mobile Number' })).toBeInTheDocument()
    expect(screen.getByText('Enter the 6-digit code sent on WhatsApp to +91 9876543210.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend OTP in 45s' })).toBeDisabled()
  })

  it('names SMS and email as the channel when the server fell back', async () => {
    const a = setup()
    await toOtpStage({ channel: 'sms' })
    expect(screen.getByText(/sent by SMS to \+91 9876543210/)).toBeInTheDocument()
    a.onCancel.mockReset()
    document.body.innerHTML = ''
    setup()
    await toOtpStage({ channel: 'email' })
    expect(screen.getByText(/code we emailed you to verify \+91 9876543210/)).toBeInTheDocument()
  })

  it('shows the server error and the rate-limit cooldown when sending fails', async () => {
    setup()
    fetchMock.mockResolvedValueOnce(res({ error: 'Too many attempts', retryAfter: 60 }, false, 429))
    typePhone('9876543210')
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
    expect(await screen.findByText('Too many attempts')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Add Mobile Number' })).toBeInTheDocument()
  })

  it('counts the resend cooldown down and then allows resending', async () => {
    setup()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await toOtpStage({ channel: 'whatsapp', nextCooldown: 2 })
    expect(screen.getByRole('button', { name: 'Resend OTP in 2s' })).toBeDisabled()
    for (let i = 0; i < 3; i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    const resend = await screen.findByRole('button', { name: 'Resend OTP' })
    expect(resend).toBeEnabled()
    fetchMock.mockResolvedValueOnce(res({ channel: 'whatsapp', nextCooldown: 30 }))
    fireEvent.click(resend)
    await waitFor(() => expect(calls('/api/auth/phone/send-otp')).toHaveLength(2))
  })

  it('verifies the code, refreshes the user and reports success', async () => {
    const { onVerified } = setup()
    await toOtpStage()
    const verify = screen.getByRole('button', { name: 'Verify & Continue' })
    expect(verify).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Enter OTP *'), { target: { value: '12a3456' } })
    expect(screen.getByLabelText('Enter OTP *')).toHaveValue('123456')
    fetchMock.mockResolvedValueOnce(res({}))
    fireEvent.click(verify)
    await waitFor(() => expect(onVerified).toHaveBeenCalled())
    expect(JSON.parse(calls('/api/auth/phone/verify-otp')[0][1].body)).toEqual({ phone: '9876543210', otp: '123456' })
    expect(refreshUser).toHaveBeenCalled()
  })

  it('records policy acceptance and saves the date of birth after verification', async () => {
    const { onVerified } = setup({ requiresPolicy: true, requiresDob: true })
    fireEvent.change(screen.getByLabelText('dob'), { target: { value: '1990-05-17' } })
    fireEvent.click(screen.getByRole('checkbox'))
    await toOtpStage()
    fireEvent.change(screen.getByLabelText('Enter OTP *'), { target: { value: '123456' } })
    fetchMock.mockResolvedValue(res({}))
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }))
    await waitFor(() => expect(onVerified).toHaveBeenCalled())
    expect(calls('/api/user/accept-policies')).toHaveLength(1)
    const upd = calls('/api/user/update')[0]
    expect(upd[1].method).toBe('PATCH')
    expect(JSON.parse(upd[1].body)).toEqual({ dateOfBirth: '1990-05-17' })
  })

  it('shows the error and does not finish when the code is wrong', async () => {
    const { onVerified } = setup()
    await toOtpStage()
    fireEvent.change(screen.getByLabelText('Enter OTP *'), { target: { value: '000000' } })
    fetchMock.mockResolvedValueOnce(res({ error: 'Invalid code' }, false))
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }))
    expect(await screen.findByText('Invalid code')).toBeInTheDocument()
    expect(onVerified).not.toHaveBeenCalled()
    expect(refreshUser).not.toHaveBeenCalled()
  })

  it('surfaces a failure to save the date of birth', async () => {
    const { onVerified } = setup({ requiresDob: true })
    fireEvent.change(screen.getByLabelText('dob'), { target: { value: '1990-05-17' } })
    await toOtpStage()
    fireEvent.change(screen.getByLabelText('Enter OTP *'), { target: { value: '123456' } })
    fetchMock.mockResolvedValueOnce(res({})).mockResolvedValueOnce(res({ error: 'Too young' }, false))
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }))
    expect(await screen.findByText('Too young')).toBeInTheDocument()
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('"Change number" returns to the phone stage and clears the code', async () => {
    setup()
    await toOtpStage()
    fireEvent.click(screen.getByRole('button', { name: 'Change number' }))
    expect(screen.getByRole('heading', { name: 'Add Mobile Number' })).toBeInTheDocument()
    expect(screen.getByLabelText('Mobile Number *')).toHaveValue('9876543210')
  })

  it('cancel calls onCancel; with abandonOnCancel it first abandons the half-made signup', async () => {
    const a = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and sign out' }))
    await waitFor(() => expect(a.onCancel).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
    document.body.innerHTML = ''
    fetchMock.mockResolvedValue(res({}))
    const b = setup({ abandonOnCancel: true })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and sign out' }))
    await waitFor(() => expect(b.onCancel).toHaveBeenCalled())
    expect(calls('/api/auth/abandon-signup')).toHaveLength(1)
  })
})

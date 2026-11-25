import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import MobileNumberCard from '@/components/admin/MobileNumberCard'

// Loads the admin's number; Add/Change opens a phone field -> send-otp (channel label) -> verify-otp.

const fetchMock = vi.fn<(...a: any[]) => any>()
const res = (ok: boolean, data: any) => ({ ok, json: async () => data })

beforeEach(() => vi.stubGlobal('fetch', fetchMock))

describe('MobileNumberCard', () => {
  it('shows Loading until the number resolves', async () => {
    fetchMock.mockResolvedValue(res(true, { mobile: null }))
    render(<MobileNumberCard />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText(/No number yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a number' })).toBeInTheDocument()
  })

  it('shows the verified number with a Change action', async () => {
    fetchMock.mockResolvedValue(res(true, { mobile: '+919876543210' }))
    render(<MobileNumberCard />)
    expect(await screen.findByText('+919876543210')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change number' })).toBeInTheDocument()
  })

  it('treats a failed load as no number', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<MobileNumberCard />)
    expect(await screen.findByText(/No number yet/)).toBeInTheDocument()
  })

  it('requires 10 digits before Send code is enabled', async () => {
    fetchMock.mockResolvedValue(res(true, { mobile: null }))
    render(<MobileNumberCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a number' }))
    const send = screen.getByRole('button', { name: 'Send code' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('+91 98765 43210'), { target: { value: '+91 98765 43210' } })
    expect(send).toBeEnabled()
  })

  it('sends a code, verifies it and shows the new number', async () => {
    fetchMock.mockResolvedValueOnce(res(true, { mobile: null }))
    render(<MobileNumberCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a number' }))
    fireEvent.change(screen.getByPlaceholderText('+91 98765 43210'), { target: { value: '9876543210' } })
    fetchMock.mockResolvedValueOnce(res(true, { channel: 'whatsapp' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    const otp = await screen.findByPlaceholderText('Code sent on WhatsApp')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/account/mobile/send-otp')
    expect(screen.getByRole('button', { name: 'Send again' })).toBeInTheDocument()
    const verify = screen.getByRole('button', { name: 'Verify' })
    fireEvent.change(otp, { target: { value: '12a345' } })
    expect(otp).toHaveValue('12345')
    expect(verify).toBeDisabled()
    fireEvent.change(otp, { target: { value: '123456' } })
    fetchMock.mockResolvedValueOnce(res(true, { mobile: '+919876543210' }))
    fireEvent.click(verify)
    expect(await screen.findByText('+919876543210')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ otp: '123456' })
    expect(screen.getByRole('button', { name: 'Change number' })).toBeInTheDocument()
  })

  it('labels SMS delivery and surfaces API errors', async () => {
    fetchMock.mockResolvedValueOnce(res(true, { mobile: null }))
    render(<MobileNumberCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a number' }))
    fireEvent.change(screen.getByPlaceholderText('+91 98765 43210'), { target: { value: '9876543210' } })
    fetchMock.mockResolvedValueOnce(res(false, { error: 'Too many attempts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('Too many attempts')).toBeInTheDocument()
    fetchMock.mockResolvedValueOnce(res(true, { channel: 'sms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Code sent on SMS')).toBeInTheDocument())
  })
})

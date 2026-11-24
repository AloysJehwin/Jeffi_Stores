import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const confirmFn = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))

import TwoFactorCard from '@/components/admin/TwoFactorCard'

const fetchMock = vi.fn<(...a: any[]) => any>()
const res = (ok: boolean, data: any) => ({ ok, json: async () => data })
const status = (o: Record<string, any> = {}) => ({ mfa_enabled: true, mfa_enrolled_at: '2026-03-05T00:00:00Z', recovery_codes_remaining: 7, ...o })

beforeEach(() => {
  confirmFn.mockResolvedValue(true)
  vi.stubGlobal('fetch', fetchMock)
})

describe('TwoFactorCard', () => {
  it('shows Loading until the status arrives', async () => {
    fetchMock.mockResolvedValue(res(true, status()))
    render(<TwoFactorCard />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText(/Enrolled on/)).toHaveTextContent('2026')
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('explains the requirement and hides regenerate when MFA is off', async () => {
    fetchMock.mockResolvedValue(res(true, status({ mfa_enabled: false, mfa_enrolled_at: null, recovery_codes_remaining: 0 })))
    render(<TwoFactorCard />)
    expect(await screen.findByText('Not enabled')).toBeInTheDocument()
    expect(screen.getByText(/required for all admins/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerate recovery codes' })).not.toBeInTheDocument()
  })

  it('stays on Loading when the status fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    render(<TwoFactorCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('confirms, regenerates, shows the new codes and refreshes the count', async () => {
    fetchMock
      .mockResolvedValueOnce(res(true, status()))
      .mockResolvedValueOnce(res(true, { recovery_codes: ['AAAA-1111', 'BBBB-2222'] }))
      .mockResolvedValueOnce(res(true, status({ recovery_codes_remaining: 10 })))
    const writeText = vi.fn<(...a: any[]) => any>()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<TwoFactorCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate recovery codes' }))
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument()
    expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ title: 'Regenerate recovery codes?', variant: 'danger' }))
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Copy all codes' }))
    expect(writeText).toHaveBeenCalledWith('AAAA-1111\nBBBB-2222')
  })

  it('does not regenerate when the confirm is declined', async () => {
    confirmFn.mockResolvedValue(false)
    fetchMock.mockResolvedValue(res(true, status()))
    render(<TwoFactorCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate recovery codes' }))
    await waitFor(() => expect(confirmFn).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the server error when regeneration fails', async () => {
    fetchMock.mockResolvedValueOnce(res(true, status())).mockResolvedValueOnce(res(false, { error: 'Re-auth required' }))
    render(<TwoFactorCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate recovery codes' }))
    expect(await screen.findByText('Re-auth required')).toBeInTheDocument()
    expect(screen.queryByText(/will not be shown again/)).not.toBeInTheDocument()
  })
})

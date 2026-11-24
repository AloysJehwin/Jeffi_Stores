import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))

import NumberBuyPanel from '@/components/admin/messaging/NumberBuyPanel'

const ok = (data: unknown) => ({ ok: true, json: async () => data })

describe('NumberBuyPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('searches numbers, buys the picked one and refreshes', async () => {
    fetchMock.mockResolvedValueOnce(ok({ numbers: [{ number: '+18725550001', locality: 'Chicago', region: 'IL' }, { number: '+18725550002', locality: null, region: null }], monthlyUsd: 1.15, live: true }))
    fetchMock.mockResolvedValueOnce(ok({ result: {} }))
    render(<NumberBuyPanel tenantId="t1" audience="ecom" storeName="Halo" rows={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get a number' }))
    expect(screen.getByDisplayValue('Halo for Business')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Search numbers' }))
    expect(await screen.findByText('+18725550001')).toBeInTheDocument()
    expect(screen.getByText('Chicago, IL')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/numbers/available?country=US&areaCode=872')
    fireEvent.click(screen.getByLabelText(/\+18725550002/))
    fireEvent.click(screen.getByRole('button', { name: 'Buy and bind' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/ecom/t1/numbers')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ audience: 'ecom', number: '+18725550002', displayName: 'Halo for Business' })
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('+18725550002 bought'), 'success')
  })

  it('shows test mode, an empty result and a search failure', async () => {
    fetchMock.mockResolvedValueOnce(ok({ numbers: [], live: false }))
    render(<NumberBuyPanel tenantId="t1" audience="customer" storeName="Halo" rows={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get a number' }))
    fireEvent.click(screen.getByRole('button', { name: 'Search numbers' }))
    expect(await screen.findByText('No numbers found for that area code.')).toBeInTheDocument()
    expect(screen.getByText(/Test mode/)).toBeInTheDocument()
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Twilio down' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Search numbers' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Twilio down', 'error'))
  })

  it('shows a bought number with WhatsApp status, retries and releases it', async () => {
    const rows = [
      { channel: 'whatsapp', sender: '+18725550009', meta: { platform_account: true, wa_status: 'NOT_REGISTERED', wa_error: 'Name rejected', wa_display_name: 'Halo' } },
    ] as never
    fetchMock.mockResolvedValue(ok({}))
    render(<NumberBuyPanel tenantId="t1" audience="customer" storeName="Halo" rows={rows} />)
    expect(screen.getByText('Bought by the platform: +18725550009')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp not registered')).toBeInTheDocument()
    expect(screen.getByText('Name rejected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry WhatsApp/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('WhatsApp registration restarted', 'success'))
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    fireEvent.click(screen.getByRole('button', { name: /Release number/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Number released', 'success'))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/ecom/t1/numbers?audience=customer')
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
  })
})

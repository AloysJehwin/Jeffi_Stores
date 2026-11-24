import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import DeliverySettingsForm from '@/components/admin/DeliverySettingsForm'

const initial = { enabled: true, freeThreshold: 1000, ratePerKg: 0, freeWeightCeilingKg: 3 }

describe('DeliverySettingsForm', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders the toggle, threshold and a preview using the free threshold', () => {
    render(<DeliverySettingsForm initial={initial} />)
    expect(screen.getByText('Charge for delivery')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('spinbutton')).toHaveValue(1000)
    // 500 pays the base charge, 2000 and 6000 clear the threshold.
    expect(screen.getByText('₹120.00')).toBeInTheDocument()
    expect(screen.getAllByText('Free')).toHaveLength(2)
    expect(screen.getAllByText(/≥ ₹1000 threshold/)).toHaveLength(2)
  })

  it('turning delivery off saves the setting, says it is free and toasts', async () => {
    render(<DeliverySettingsForm initial={initial} />)
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved', 'success'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/settings')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ key: 'delivery_charges_enabled', value: 'false' })
    expect(screen.getByText(/Delivery is FREE on every order/)).toBeInTheDocument()
    expect(screen.getAllByText('delivery disabled')).toHaveLength(3)
  })

  it('saves the free threshold on blur using the typed value', async () => {
    render(<DeliverySettingsForm initial={initial} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '3000' } })
    fireEvent.blur(input)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ key: 'delivery_free_threshold', value: '3000' })
    // The preview reacts: 2000 no longer clears the 3000 threshold.
    expect(screen.getAllByText('Free')).toHaveLength(1)
  })

  it('toasts the API error when a save fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Forbidden' }) })
    render(<DeliverySettingsForm initial={initial} />)
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Forbidden', 'error'))
  })

  it('falls back to a generic message when the error body is unreadable', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => Promise.reject(new Error('bad json')) })
    render(<DeliverySettingsForm initial={initial} />)
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save', 'error'))
  })

  it('disables the controls without settings:write', () => {
    canWrite = false
    render(<DeliverySettingsForm initial={initial} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('spinbutton')).toBeDisabled()
  })
})

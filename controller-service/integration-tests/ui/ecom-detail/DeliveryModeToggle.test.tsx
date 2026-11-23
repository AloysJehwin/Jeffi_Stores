import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>() }) }))

import DeliveryModeToggle from '@controller/components/admin/ecom/detail/DeliveryModeToggle'

describe('DeliveryModeToggle (render + branches + interaction)', () => {
  it('shows platform mode with a switch when a token exists', () => {
    render(<DeliveryModeToggle tenantId="t1" initial={false} hasOwnCreds />)
    expect(screen.getByText(/Platform \(wallet debit\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Switch to own Delhivery/ })).toBeEnabled()
  })

  it('disables and hints without a token', () => {
    render(<DeliveryModeToggle tenantId="t1" initial={false} hasOwnCreds={false} />)
    expect(screen.getByRole('button', { name: /Switch to own Delhivery/ })).toBeDisabled()
    expect(screen.getByText(/Connect a Delhivery token first/)).toBeInTheDocument()
  })

  it('shows own-Delhivery mode when already on', () => {
    render(<DeliveryModeToggle tenantId="t1" initial hasOwnCreds />)
    expect(screen.getByText(/Own Delhivery/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Switch to platform/ })).toBeInTheDocument()
  })

  it('PATCHes the delivery-mode endpoint after confirm', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<DeliveryModeToggle tenantId="shopY" initial={false} hasOwnCreds />)
    fireEvent.click(screen.getByRole('button', { name: /Switch to own Delhivery/ }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/shopY/delivery-mode')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ own_delhivery: true })
  })
})

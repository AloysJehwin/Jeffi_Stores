import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>() }) }))

import AccountModeToggle from '@controller/components/admin/ecom/detail/AccountModeToggle'

describe('AccountModeToggle (render + branches + interaction)', () => {
  it('shows platform mode and offers a switch to own Razorpay when creds exist', () => {
    render(<AccountModeToggle tenantId="t1" initial={false} hasOwnCreds />)
    expect(screen.getByText(/Platform \(Route settlement\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Switch to own Razorpay/ })).toBeEnabled()
  })

  it('disables the switch and hints when there are no creds', () => {
    render(<AccountModeToggle tenantId="t1" initial={false} hasOwnCreds={false} />)
    expect(screen.getByRole('button', { name: /Switch to own Razorpay/ })).toBeDisabled()
    expect(screen.getByText(/Connect a Razorpay account first/)).toBeInTheDocument()
  })

  it('shows own-Razorpay mode when already on', () => {
    render(<AccountModeToggle tenantId="t1" initial hasOwnCreds />)
    expect(screen.getByText(/Own Razorpay/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Switch to platform/ })).toBeInTheDocument()
  })

  it('PATCHes the account-mode endpoint after confirm', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<AccountModeToggle tenantId="shopX" initial={false} hasOwnCreds />)
    fireEvent.click(screen.getByRole('button', { name: /Switch to own Razorpay/ }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/shopX/account-mode')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ own_razorpay: true })
  })
})

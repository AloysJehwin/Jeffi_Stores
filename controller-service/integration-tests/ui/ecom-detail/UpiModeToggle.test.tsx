import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>() }) }))

import UpiModeToggle from '@controller/components/admin/ecom/detail/UpiModeToggle'

describe('UpiModeToggle (render + branches + interaction)', () => {
  it('renders ON with the PhonePe provider and a Turn off button', () => {
    render(<UpiModeToggle tenantId="t1" initial="auto" hasPhonePe upiId={null} />)
    expect(screen.getByText(/On · PhonePe/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
  })

  it('renders OFF with a Turn on button', () => {
    render(<UpiModeToggle tenantId="t1" initial="off" hasPhonePe={false} upiId="store@upi" />)
    expect(screen.getByText(/Off \(no UPI at checkout\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
  })

  it('treats a legacy mode value as ON and shows the UPI-ID provider', () => {
    render(<UpiModeToggle tenantId="t1" initial="platform" hasPhonePe={false} upiId="store@upi" />)
    expect(screen.getByText(/Direct to the store/)).toBeInTheDocument()
  })

  it('PATCHes upi-mode to off after confirm', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<UpiModeToggle tenantId="shopZ" initial="auto" hasPhonePe upiId={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/shopZ/upi-mode')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ mode: 'off' })
  })
})

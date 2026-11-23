import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ActionButton pulls scope + confirm from these contexts; stub them so the button logic runs
// without providers. No confirm on this action, so useConfirm is a pass-through.
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>() }) }))

import DnsResyncButton from '@controller/components/admin/ecom/detail/DnsResyncButton'

describe('DnsResyncButton (render + interaction)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the re-sync button', () => {
    render(<DnsResyncButton tenantId="t1" />)
    expect(screen.getByRole('button', { name: /Re-sync DNS/ })).toBeInTheDocument()
  })

  it('is disabled when the disabled prop is set', () => {
    render(<DnsResyncButton tenantId="t1" disabled />)
    expect(screen.getByRole('button', { name: /Re-sync DNS/ })).toBeDisabled()
  })

  it('POSTs to the resync endpoint on click', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ added: ['a'], removed: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<DnsResyncButton tenantId="t42" />)
    fireEvent.click(screen.getByRole('button', { name: /Re-sync DNS/ }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/t42/dns/resync')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })
})

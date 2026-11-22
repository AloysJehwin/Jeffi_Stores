import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>() }) }))

import ReconcileButton from '@controller/components/admin/ecom/detail/ReconcileButton'

describe('ReconcileButton (render + interaction)', () => {
  it('renders the reconcile button', () => {
    render(<ReconcileButton tenantId="t1" />)
    expect(screen.getByRole('button', { name: /Reconcile now/ })).toBeInTheDocument()
  })

  it('POSTs to the reconcile endpoint on click', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ settled: 2, scanned: 5 }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ReconcileButton tenantId="store9" />)
    fireEvent.click(screen.getByRole('button', { name: /Reconcile now/ }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/store9/reconcile-settlements')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })
})

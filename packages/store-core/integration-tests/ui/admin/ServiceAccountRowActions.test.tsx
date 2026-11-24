import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ServiceAccountRowActions: confirmed Revoke -> DELETE; success toast + refresh, failure toast.

const showToast = vi.fn<(...a: any[]) => any>()
const refresh = vi.fn<(...a: any[]) => any>()
const confirmFn = vi.fn<(...a: any[]) => any>()

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import ServiceAccountRowActions from '@/components/admin/ServiceAccountRowActions'

const fetchMock = vi.fn<(...a: any[]) => any>()

beforeEach(() => {
  confirmFn.mockResolvedValue(true)
  vi.stubGlobal('fetch', fetchMock)
})

describe('ServiceAccountRowActions', () => {
  it('shows a Revoke button', () => {
    render(<ServiceAccountRowActions id="s1" name="CI bot" />)
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
  })

  it('warns in the confirm, revokes, toasts success and refreshes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<ServiceAccountRowActions id="s1" name="CI bot" />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ title: 'Revoke service account?', message: expect.stringContaining('"CI bot"') }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/service-accounts/s1', { method: 'DELETE' })
    expect(showToast).toHaveBeenCalledWith('Service account "CI bot" revoked', 'success')
  })

  it('toasts the API error and skips refresh on failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'In use' }) })
    render(<ServiceAccountRowActions id="s1" name="CI bot" />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('In use', 'error'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('falls back to a generic error message', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new Error('x') } })
    render(<ServiceAccountRowActions id="s1" name="CI bot" />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to revoke service account', 'error'))
  })

  it('does not call the API when the confirm is declined', async () => {
    confirmFn.mockResolvedValue(false)
    render(<ServiceAccountRowActions id="s1" name="CI bot" />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(confirmFn).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

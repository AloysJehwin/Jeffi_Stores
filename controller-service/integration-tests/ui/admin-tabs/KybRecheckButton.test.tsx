import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))

import KybRecheckButton from '@controller/components/admin/ecom/tabs/KybRecheckButton'

const view = (checking: number) =>
  render(
    <ToastProvider>
      <KybRecheckButton tenantId="t1" checking={checking} />
    </ToastProvider>,
  )

describe('KybRecheckButton', () => {
  afterEach(() => vi.useRealTimers())

  it('shows no progress note when nothing is being checked', () => {
    view(0)
    expect(screen.queryByText(/Checking/)).toBeNull()
    expect(screen.getByRole('button', { name: /Run checks again/ })).toBeInTheDocument()
  })

  it('pluralises the in-progress note', () => {
    const { unmount } = view(1)
    expect(screen.getByText('Checking 1 document')).toBeInTheDocument()
    unmount()
    view(3)
    expect(screen.getByText('Checking 3 documents')).toBeInTheDocument()
  })

  it('POSTs the recheck, toasts the count and refreshes', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ count: 2 }) })
    vi.stubGlobal('fetch', fetchMock)
    view(0)
    fireEvent.click(screen.getByRole('button', { name: /Run checks again/ }))
    expect(await screen.findByText(/Checking 2 documents again/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/kyc/t1/kyb/recheck')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(refresh).toHaveBeenCalled()
  })

  it('says nothing was checked when every document is approved', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) }))
    view(0)
    fireEvent.click(screen.getByRole('button', { name: /Run checks again/ }))
    expect(await screen.findByText(/approved documents aren’t checked again/)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('toasts the server error', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'KYB service down' }) }))
    view(0)
    fireEvent.click(screen.getByRole('button', { name: /Run checks again/ }))
    expect(await screen.findByText('KYB service down')).toBeInTheDocument()
  })

  it('polls with router.refresh every 5s while documents are being checked', async () => {
    vi.useFakeTimers()
    view(2)
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})

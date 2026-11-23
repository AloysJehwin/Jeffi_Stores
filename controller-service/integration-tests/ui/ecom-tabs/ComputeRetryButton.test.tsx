import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ComputeRetryButton from '@controller/components/admin/ecom/tabs/ComputeRetryButton'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
// Flip the write scope per test.
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))

describe('ComputeRetryButton (scope gate + retry)', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('renders nothing when the admin cannot write', () => {
    canWrite = false
    const { container } = render(<ComputeRetryButton tenantId="t1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a Retry button when the admin can write', () => {
    render(<ComputeRetryButton tenantId="t1" />)
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })

  it('PUTs the retry action and refreshes on success', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    render(<ComputeRetryButton tenantId="store-9" />)
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/ecom/store-9/compute')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ action: 'retry' })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))

    vi.unstubAllGlobals()
  })

  it('does not refresh when the retry call fails', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'nope' }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<ComputeRetryButton tenantId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(refresh).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

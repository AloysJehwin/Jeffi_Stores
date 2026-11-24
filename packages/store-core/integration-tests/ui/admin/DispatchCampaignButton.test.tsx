import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import DispatchCampaignButton from '@/components/admin/DispatchCampaignButton'

describe('DispatchCampaignButton', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders nothing without campaigns:write', () => {
    canWrite = false
    const { container } = render(<DispatchCampaignButton id="c1" />)
    expect(container.firstChild).toBeNull()
  })

  it('dispatches now, shows Sent! and refreshes the page', async () => {
    render(<DispatchCampaignButton id="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sent!' })).toBeDisabled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/mailer/c1/send')
    expect(JSON.parse(init.body)).toEqual({ dispatchNow: true })
    expect(refresh).toHaveBeenCalled()
  })

  it('toasts the lock error on 423 and stays dispatchable', async () => {
    fetchMock.mockResolvedValue({ status: 423, json: async () => ({ error: 'Asha is editing' }) })
    render(<DispatchCampaignButton id="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Asha is editing', 'error'))
    expect(screen.getByRole('button', { name: 'Dispatch' })).toBeEnabled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('auto-dispatches when the scheduled time has passed', async () => {
    render(<DispatchCampaignButton id="c2" scheduledAt="2020-01-01T00:00:00Z" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/mailer/c2/send')
  })

  it('does not auto-dispatch a future schedule', () => {
    render(<DispatchCampaignButton id="c2" scheduledAt="2999-01-01T00:00:00Z" />)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

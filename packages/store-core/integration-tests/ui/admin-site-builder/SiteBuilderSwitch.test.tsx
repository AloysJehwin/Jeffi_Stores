import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// SiteBuilderSwitch: the control that makes a builder live / sets Site Builder up. Guards on write scope, posts to
// /api/admin/site-builder, toasts and refreshes. We mock the scope + toast contexts, the api() helper and the router.

let canWrite = true
const showToast = vi.fn<(...a: any[]) => any>()
const showConfirm = vi.fn<(...a: any[]) => Promise<boolean>>()
const refresh = vi.fn<(...a: any[]) => any>()
const api = vi.fn<(...a: any[]) => Promise<any>>()

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast, showConfirm }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/admin/kit/core', () => ({ api: (...a: any[]) => api(...a) }))

import SiteBuilderSwitch from '@/components/admin/site-builder/SiteBuilderSwitch'

beforeEach(() => {
  canWrite = true
  showToast.mockReset()
  showConfirm.mockReset()
  refresh.mockReset()
  api.mockReset()
  api.mockResolvedValue({ ok: true, data: {} })
})

describe('SiteBuilderSwitch (scope gating + branches)', () => {
  it('renders nothing without write scope', () => {
    canWrite = false
    const { container } = render(<SiteBuilderSwitch target="site" live={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the target is already live (non-setup)', () => {
    const { container } = render(<SiteBuilderSwitch target="site" live={true} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the make-live button for a not-yet-live builder', () => {
    render(<SiteBuilderSwitch target="homepage" live={false} />)
    expect(screen.getByRole('button', { name: /Make Homepage builder live/ })).toBeInTheDocument()
  })

  it('shows the setup card and CTA in setup mode', () => {
    render(<SiteBuilderSwitch target="site" live={false} setup />)
    expect(screen.getByText('Build your site from blocks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up Site Builder' })).toBeInTheDocument()
  })

  it('posts setup=true and toasts success when setting up', async () => {
    render(<SiteBuilderSwitch target="site" live={false} setup />)
    fireEvent.click(screen.getByRole('button', { name: 'Set up Site Builder' }))
    await waitFor(() => expect(api).toHaveBeenCalled())
    expect(api).toHaveBeenCalledWith('/api/admin/site-builder', { method: 'POST', json: { setup: true } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Site Builder is ready to edit', 'success'))
    expect(refresh).toHaveBeenCalled()
  })

  it('confirms, then posts enabled=true when making Site Builder live', async () => {
    showConfirm.mockResolvedValue(true)
    render(<SiteBuilderSwitch target="site" live={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Make Site Builder live/ }))
    await waitFor(() => expect(showConfirm).toHaveBeenCalled())
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/admin/site-builder', { method: 'POST', json: { enabled: true } }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Site Builder is live', 'success'))
  })

  it('does not post when the confirm is declined', async () => {
    showConfirm.mockResolvedValue(false)
    render(<SiteBuilderSwitch target="homepage" live={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Make Homepage builder live/ }))
    await waitFor(() => expect(showConfirm).toHaveBeenCalled())
    expect(api).not.toHaveBeenCalled()
  })

  it('surfaces an error toast when the api call fails', async () => {
    api.mockResolvedValue({ ok: false, data: { error: 'nope' } })
    render(<SiteBuilderSwitch target="site" live={false} setup />)
    fireEvent.click(screen.getByRole('button', { name: 'Set up Site Builder' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('nope', 'error'))
    expect(refresh).not.toHaveBeenCalled()
  })
})

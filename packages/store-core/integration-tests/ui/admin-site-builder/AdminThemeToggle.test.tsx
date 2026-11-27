import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// AdminThemeToggle: loads whether the admin wears the store theme, saves a flip, toasts, then reloads the page (the
// theme lives in the root layout). We mock the scope + toast contexts and the api() helper.

let canWrite = true
const showToast = vi.fn<(...a: any[]) => any>()
const api = vi.fn<(...a: any[]) => Promise<any>>()
const reload = vi.fn()
const realLocation = window.location

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/components/admin/kit/core', () => ({ api: (...a: any[]) => api(...a) }))

import AdminThemeToggle from '@/components/admin/site-builder/AdminThemeToggle'

const ENDPOINT = '/api/admin/site-builder/admin-theme'

beforeEach(() => {
  canWrite = true
  showToast.mockReset()
  api.mockReset()
  reload.mockReset()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('AdminThemeToggle', () => {
  it('shows the saved setting once loaded', async () => {
    api.mockResolvedValue({ ok: true, data: { enabled: true } })
    render(<AdminThemeToggle />)
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
    expect(api).toHaveBeenCalledWith(ENDPOINT)
    expect(screen.getByText('Use this theme in the admin panel too')).toBeInTheDocument()
  })

  it('turns it on, toasts and reloads the page', async () => {
    api.mockResolvedValueOnce({ ok: true, data: { enabled: false } }).mockResolvedValueOnce({ ok: true, data: { enabled: true } })
    render(<AdminThemeToggle />)
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(api).toHaveBeenLastCalledWith(ENDPOINT, { method: 'POST', json: { enabled: true } })
    expect(showToast).toHaveBeenCalledWith('Admin panel now uses this theme', 'success')
  })

  it('a failed save toasts the error and does not reload', async () => {
    api.mockResolvedValueOnce({ ok: true, data: { enabled: false } }).mockResolvedValueOnce({ ok: false, data: { error: 'Nope' } })
    render(<AdminThemeToggle />)
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nope', 'error'))
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('is locked without write scope', async () => {
    canWrite = false
    api.mockResolvedValue({ ok: true, data: { enabled: false } })
    render(<AdminThemeToggle />)
    await waitFor(() => expect(api).toHaveBeenCalled())
    expect(screen.getByRole('switch')).toBeDisabled()
  })
})

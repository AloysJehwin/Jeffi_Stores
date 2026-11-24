import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// MailerRowActions: View link + a scoped, confirmed Delete that DELETEs the campaign and refreshes.

let canWrite = true
const showToast = vi.fn<(...a: any[]) => any>()
const refresh = vi.fn<(...a: any[]) => any>()
const confirmFn = vi.fn<(...a: any[]) => any>()

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import MailerRowActions from '@/components/admin/MailerRowActions'

const fetchMock = vi.fn<(...a: any[]) => any>()

beforeEach(() => {
  canWrite = true
  confirmFn.mockResolvedValue(true)
  fetchMock.mockResolvedValue({ status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
})

describe('MailerRowActions', () => {
  it('links to the campaign and offers delete when allowed', () => {
    render(<MailerRowActions id="c1" title="Diwali" viewHref="/admin/mailer/c1" canDelete />)
    expect(screen.getByRole('link', { name: 'View campaign' })).toHaveAttribute('href', '/admin/mailer/c1')
    expect(screen.getByRole('button', { name: 'Delete Campaign' })).toBeInTheDocument()
  })

  it('hides delete when canDelete is false', () => {
    render(<MailerRowActions id="c1" title="Diwali" viewHref="/x" canDelete={false} />)
    expect(screen.queryByRole('button', { name: 'Delete Campaign' })).not.toBeInTheDocument()
  })

  it('hides delete without campaigns:write', () => {
    canWrite = false
    render(<MailerRowActions id="c1" title="Diwali" viewHref="/x" canDelete />)
    expect(screen.queryByRole('button', { name: 'Delete Campaign' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View campaign' })).toBeInTheDocument()
  })

  it('confirms, DELETEs and refreshes', async () => {
    render(<MailerRowActions id="c1" title="Diwali" viewHref="/x" canDelete />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Campaign' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('"Diwali"'), variant: 'danger' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/mailer/c1', { method: 'DELETE' })
  })

  it('does nothing when the confirm is declined', async () => {
    confirmFn.mockResolvedValue(false)
    render(<MailerRowActions id="c1" title="Diwali" viewHref="/x" canDelete />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Campaign' }))
    await waitFor(() => expect(confirmFn).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('toasts the server message on a 423 edit lock', async () => {
    fetchMock.mockResolvedValue({ status: 423, json: async () => ({ error: 'Locked by Asha' }) })
    render(<MailerRowActions id="c1" title="Diwali" viewHref="/x" canDelete />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Campaign' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Locked by Asha', 'error'))
    expect(refresh).toHaveBeenCalled()
  })
})

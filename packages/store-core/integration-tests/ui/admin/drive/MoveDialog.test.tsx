import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const list = vi.fn()
vi.mock('@/components/admin/drive/api', () => ({ driveApi: { list: (...a: any[]) => list(...a) } }))

import MoveDialog from '@/components/admin/drive/MoveDialog'

const folder = (id: string, name: string, o: any = {}) => ({ id, parentId: null, name, visibility: 'private', systemKey: null, ownerAdminId: 'a', ownerName: 'Priya', createdAt: '', access: 'edit', ...o })

const root = { folder: null, folders: [folder('f1', 'Invoices'), folder('gallery', 'Gallery'), folder('f2', 'Hidden')], files: [], total: 0, path: [] }
const inInvoices = { folder: folder('f1', 'Invoices'), folders: [folder('f3', '2026')], files: [], total: 0, path: [{ id: 'f1', name: 'Invoices' }] }

beforeEach(() => {
  list.mockReset()
  list.mockImplementation(async ({ folder }: any) => (folder === 'f1' ? inInvoices : root))
})

describe('MoveDialog', () => {
  it('lists folders at the top, hiding the gallery and excluded folders, with a loading state first', async () => {
    render(<MoveDialog title="Move file" exclude={['f2']} onMove={vi.fn()} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Move file' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Invoices/ })).toBeInTheDocument()
    expect(screen.queryByText('Gallery')).toBeNull()
    expect(screen.queryByText('Hidden')).toBeNull()
    expect(list).toHaveBeenCalledWith({ folder: 'root' })
  })

  it('cannot move to the top level unless allowed', async () => {
    const { rerender } = render(<MoveDialog title="Move" onMove={vi.fn()} onClose={() => {}} />)
    await screen.findByRole('button', { name: /Invoices/ })
    expect(screen.getByRole('button', { name: 'Open a folder' })).toBeDisabled()
    rerender(<MoveDialog title="Move" allowRoot onMove={vi.fn()} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Move to the top level' })).toBeEnabled()
  })

  it('opens a folder, shows the breadcrumb and Up, and moves there', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined)
    render(<MoveDialog title="Move" onMove={onMove} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Invoices/ }))
    expect(await screen.findByRole('button', { name: /2026/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Up/ })).toBeInTheDocument()
    const go = await screen.findByRole('button', { name: 'Move to Invoices' })
    fireEvent.click(go)
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('f1'))
  })

  it('Up and the Drive crumb go back to the top, and the top level moves with null', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined)
    render(<MoveDialog title="Move" allowRoot onMove={onMove} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Invoices/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Up/ }))
    await screen.findByRole('button', { name: 'Move to the top level' })
    fireEvent.click(screen.getByRole('button', { name: 'Move to the top level' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(null))
  })

  it('does not allow moving into a view-only folder', async () => {
    list.mockImplementation(async ({ folder }: any) => (folder === 'f1' ? { ...inInvoices, folder: folder_('view') } : root))
    function folder_(access: string) {
      return folder('f1', 'Invoices', { access })
    }
    render(<MoveDialog title="Move" onMove={vi.fn()} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Invoices/ }))
    await screen.findByRole('button', { name: /Up/ })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open a folder' })).toBeDisabled())
  })

  it('shows an empty message and treats a failed load as empty', async () => {
    list.mockResolvedValue({ folder: null, folders: [], files: [], total: 0, path: [] })
    const { unmount } = render(<MoveDialog title="Move" onMove={vi.fn()} onClose={() => {}} />)
    expect(await screen.findByText('No folders inside')).toBeInTheDocument()
    unmount()
    list.mockRejectedValue(new Error('x'))
    render(<MoveDialog title="Move" onMove={vi.fn()} onClose={() => {}} />)
    expect(await screen.findByText('No folders inside')).toBeInTheDocument()
  })

  it('Cancel closes without moving', async () => {
    const onClose = vi.fn()
    const onMove = vi.fn()
    render(<MoveDialog title="Move" onMove={onMove} onClose={onClose} />)
    await screen.findByRole('button', { name: /Invoices/ })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onMove).not.toHaveBeenCalled()
  })
})

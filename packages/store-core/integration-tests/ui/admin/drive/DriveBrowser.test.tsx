import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const api = {
  list: vi.fn(), createFolder: vi.fn(), updateFolder: vi.fn(), deleteFolder: vi.fn(), updateFile: vi.fn(), deleteFile: vi.fn(),
  restoreFile: vi.fn(), publish: vi.fn(), shares: vi.fn(), addShare: vi.fn(), removeShare: vi.fn(), people: vi.fn(),
}
const upload = vi.fn()
vi.mock('@/components/admin/drive/api', () => ({
  driveApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => (api as any)[k](...a) }),
  uploadDriveFile: (...a: any[]) => upload(...a),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/admin/drive' }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, label }: any) => (
    <select aria-label={label ?? 'Type'} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/ui/PdfPreview', () => ({ default: () => <div /> }))
const confirmFn = vi.fn()
const promptFn = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn, usePrompt: () => promptFn }))
let writable = true
let scopes: Record<string, boolean> = {}
vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: (s: string) => writable && (s === 'drive' || scopes[`w:${s}`] === true),
  useHasScope: (s: string) => scopes[s] === true,
}))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast: (t: string, k: string) => (toast as any)[k]?.(t) }) }))

import DriveBrowser from '@/components/admin/drive/DriveBrowser'

const file = (id: string, o: any = {}) => ({
  id, folderId: null, name: `${id}.png`, mime: 'image/png', kind: 'image', size: 1024, width: null, height: null, duration: null, blurhash: null,
  source: 'drive', createdAt: '2026-01-05T10:00:00Z', uploadedBy: 'Priya', url: `/f/${id}`, thumbUrl: null, downloadUrl: `/f/${id}/dl`, access: 'manage', ...o,
})
const folder = (id: string, name: string, o: any = {}) => ({ id, parentId: null, name, visibility: 'private', systemKey: null, ownerAdminId: 'a', ownerName: 'Priya', createdAt: '', access: 'manage', ...o })
const listing = (o: any = {}) => ({ folder: null, folders: [folder('d1', 'Docs')], files: [file('a'), file('b')], total: 2, path: [], ...o })

const renderBrowser = (p: any = {}) => render(<DriveBrowser initialFolder="root" initialTrash={false} {...p} />)

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  Object.values(toast).forEach(f => f.mockReset())
  upload.mockReset()
  confirmFn.mockReset()
  promptFn.mockReset()
  writable = true
  scopes = {}
  api.list.mockResolvedValue(listing())
  api.updateFile.mockResolvedValue({})
  api.deleteFile.mockResolvedValue({})
  api.restoreFile.mockResolvedValue({})
  api.deleteFolder.mockResolvedValue({})
  api.updateFolder.mockResolvedValue({})
  api.createFolder.mockResolvedValue({})
  api.publish.mockResolvedValue({})
  api.shares.mockResolvedValue({ shares: [] })
  api.people.mockResolvedValue({ admins: [], roles: [] })
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('DriveBrowser listing', () => {
  it('shows loading, then the folders and files, with the places nav', async () => {
    renderBrowser()
    expect(screen.getByRole('status', { name: 'Loading files' })).toBeInTheDocument()
    expect(await screen.findByText('a.png')).toBeInTheDocument()
    expect(screen.getByText('Docs')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Drive' })
    expect(within(nav).getByRole('button', { name: 'My Drive' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Gallery' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Trash' })).toBeInTheDocument()
    expect(api.list).toHaveBeenCalledWith({ folder: 'root', q: '', kind: '', trash: false }, expect.any(AbortSignal))
  })

  it('shows the empty drive state with the upload hint', async () => {
    api.list.mockResolvedValue(listing({ folders: [], files: [] }))
    renderBrowser()
    expect(await screen.findByText('Your Drive is empty')).toBeInTheDocument()
    expect(screen.getByText(/Drop files here or use Upload/)).toBeInTheDocument()
  })

  it('shows an error with Try again that reloads', async () => {
    api.list.mockRejectedValueOnce(new Error('Drive offline')).mockResolvedValue(listing())
    renderBrowser()
    expect(await screen.findByText('Drive offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('a.png')).toBeInTheDocument()
  })

  it('opens a folder and shows its breadcrumb and visibility, then goes back via My Drive', async () => {
    api.list.mockImplementation(async ({ folder: f }: any) => (f === 'd1' ? listing({ folder: folder('d1', 'Docs'), folders: [], files: [file('inside')], path: [{ id: 'd1', name: 'Docs' }] }) : listing()))
    renderBrowser()
    fireEvent.click(await screen.findByRole('button', { name: /Docs/ }))
    expect(await screen.findByText('inside.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Docs', current: 'page' })).toBeInTheDocument()
    expect(screen.getByText(/Only you and people you share with/)).toBeInTheDocument()
    expect(window.location.search).toContain('folder=d1')
    const nav = screen.getByRole('navigation', { name: 'Drive' })
    fireEvent.click(within(nav).getByRole('button', { name: 'My Drive' }))
    expect(await screen.findByText('a.png')).toBeInTheDocument()
    expect(window.location.search).not.toContain('folder=')
  })

  it('Show more appends the next page', async () => {
    api.list.mockResolvedValueOnce(listing({ total: 3 })).mockResolvedValueOnce(listing({ files: [file('c')], total: 3 }))
    renderBrowser()
    fireEvent.click(await screen.findByRole('button', { name: 'Show more (2 of 3)' }))
    expect(await screen.findByText('c.png')).toBeInTheDocument()
  })

  it('searches after a pause and filters by type', async () => {
    renderBrowser()
    await screen.findByText('a.png')
    api.list.mockClear()
    fireEvent.change(screen.getByPlaceholderText('Search all your files'), { target: { value: 'inv' } })
    await waitFor(() => expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'inv' }), expect.any(AbortSignal)))
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'pdf' } })
    await waitFor(() => expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pdf' }), expect.any(AbortSignal)))
  })

  it('switches between grid and list and remembers it', async () => {
    renderBrowser()
    await screen.findByText('a.png')
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(localStorage.getItem('drive:view')).toBe('list')
  })

  it('restores the saved layout', async () => {
    localStorage.setItem('drive:view', 'list')
    renderBrowser()
    await screen.findByText('a.png')
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})

describe('DriveBrowser places', () => {
  it('trash lists deleted files and restores one', async () => {
    api.list.mockImplementation(async ({ trash }: any) => (trash ? listing({ folders: [], files: [file('gone', { deletedAt: '2026-01-06T10:00:00Z' })], total: 1 }) : listing()))
    renderBrowser()
    await screen.findByText('a.png')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Drive' })).getByRole('button', { name: 'Trash' }))
    expect(await screen.findByText('gone.png')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search the trash')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }))
    await waitFor(() => expect(api.restoreFile).toHaveBeenCalledWith('gone'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restored'))
  })

  it('an empty trash says so', async () => {
    api.list.mockResolvedValue(listing({ folders: [], files: [] }))
    renderBrowser({ initialTrash: true })
    expect(await screen.findByText('The trash is empty')).toBeInTheDocument()
  })

  it('lists document places only for scopes the admin has', async () => {
    scopes = { 'invoices:read': true, 'quotations:read': true }
    renderBrowser()
    await screen.findByText('a.png')
    const nav = screen.getByRole('navigation', { name: 'Drive' })
    expect(within(nav).getByRole('button', { name: 'Invoices' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Quotations' })).toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: 'Packing slips' })).toBeNull()
    fireEvent.click(within(nav).getByRole('button', { name: 'Invoices' }))
    await waitFor(() => expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ folder: 'invoices' }), expect.any(AbortSignal)))
    expect(screen.getByPlaceholderText('Search invoices')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull()
  })
})

describe('DriveBrowser file actions', () => {
  it('a click opens the preview dialog', async () => {
    renderBrowser()
    fireEvent.click(await screen.findByRole('button', { name: /a\.png/ }))
    expect(await screen.findByRole('dialog', { name: 'a.png' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('rename prompts and updates the file', async () => {
    promptFn.mockResolvedValue('  new-name.png ')
    renderBrowser()
    await screen.findByText('a.png')
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await waitFor(() => expect(api.updateFile).toHaveBeenCalledWith('a', { name: 'new-name.png' }))
  })

  it('delete confirms first, then moves to the trash', async () => {
    confirmFn.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    renderBrowser()
    await screen.findByText('a.png')
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(api.deleteFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteFile).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Moved to the trash'))
  })

  it('a failed action shows its error', async () => {
    api.deleteFile.mockRejectedValue(new Error('Locked'))
    confirmFn.mockResolvedValue(true)
    renderBrowser()
    await screen.findByText('a.png')
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Locked'))
  })

  it('view-only access hides rename, move and delete', async () => {
    api.list.mockResolvedValue(listing({ folders: [], files: [file('a', { access: 'view' })] }))
    renderBrowser()
    await screen.findByText('a.png')
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })

  it('add to gallery needs a gallery scope and a confirmation', async () => {
    scopes = { 'w:products': true }
    confirmFn.mockResolvedValue(true)
    renderBrowser()
    await screen.findByText('a.png')
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to gallery' }))
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Added to the gallery'))
  })

  it('Move opens the destination dialog and moves the file', async () => {
    api.list.mockImplementation(async ({ folder: f }: any) => (f === 'root' ? listing() : listing({ folder: folder('d1', 'Docs'), folders: [], files: [] })))
    renderBrowser()
    await screen.findByText('a.png')
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move' }))
    expect(await screen.findByRole('dialog', { name: 'Move file' })).toBeInTheDocument()
    const dlg = screen.getByRole('dialog', { name: 'Move file' })
    fireEvent.click(await within(dlg).findByRole('button', { name: /Docs/ }))
    fireEvent.click(await within(dlg).findByRole('button', { name: 'Move to Docs' }))
    await waitFor(() => expect(api.updateFile).toHaveBeenCalledWith('a', { folderId: 'd1' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Moved'))
  })
})

describe('DriveBrowser selection', () => {
  it('ctrl click selects, shows the bar, and bulk delete runs after a confirmation', async () => {
    confirmFn.mockResolvedValue(true)
    renderBrowser()
    fireEvent.click(await screen.findByRole('button', { name: /a\.png/ }), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: /b\.png/ }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    await waitFor(() => expect(api.deleteFile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 files moved to the trash'))
  })

  it('Clear selection empties it', async () => {
    renderBrowser()
    fireEvent.click(await screen.findByRole('button', { name: /a\.png/ }), { ctrlKey: true })
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByText('1 selected')).toBeNull()
  })
})

describe('DriveBrowser folders and uploads', () => {
  it('creates a folder with a name and visibility', async () => {
    renderBrowser()
    await screen.findByText('a.png')
    fireEvent.click(screen.getByRole('button', { name: /New folder/ }))
    const dlg = await screen.findByRole('dialog', { name: 'New folder' })
    const create = within(dlg).getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    fireEvent.change(within(dlg).getByPlaceholderText('Folder name'), { target: { value: ' Reports ' } })
    fireEvent.change(within(dlg).getByRole('combobox', { name: 'Who can see it' }), { target: { value: 'team' } })
    fireEvent.click(create)
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith(null, 'Reports', 'team'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New folder' })).toBeNull())
  })

  it('a folder menu renames and deletes (after confirming)', async () => {
    promptFn.mockResolvedValue('Papers')
    confirmFn.mockResolvedValue(true)
    renderBrowser()
    await screen.findByText('Docs')
    const folderMenuBtn = screen.getAllByRole('button', { name: 'More actions' })[0]
    fireEvent.click(folderMenuBtn)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await waitFor(() => expect(api.updateFolder).toHaveBeenCalledWith('d1', { name: 'Papers' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Folder deleted'))
  })

  it('Share & access opens the share dialog for the folder', async () => {
    renderBrowser()
    await screen.findByText('Docs')
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share & access' }))
    expect(await screen.findByRole('dialog', { name: 'Share “Docs”' })).toBeInTheDocument()
    await waitFor(() => expect(api.shares).toHaveBeenCalledWith({ kind: 'folder', id: 'd1' }))
  })

  it('uploads picked files, shows progress and a saved toast, then reloads', async () => {
    upload.mockResolvedValue({})
    const { container } = renderBrowser()
    await screen.findByText('a.png')
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement
    const f = new File(['x'], 'new.png', { type: 'image/png' })
    api.list.mockClear()
    fireEvent.change(input, { target: { files: [f] } })
    await waitFor(() => expect(upload).toHaveBeenCalledWith(f, null, expect.any(Function)))
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Saved to My files'))
    expect(screen.getByText('new.png')).toBeInTheDocument()
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText('new.png')).toBeNull()
  })

  it('a failed upload shows its error', async () => {
    upload.mockRejectedValue(new Error('File too large'))
    const { container } = renderBrowser()
    await screen.findByText('a.png')
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'huge.mp4', { type: 'video/mp4' })] } })
    expect(await screen.findByText('File too large')).toBeInTheDocument()
  })

  it('without write access there is no upload or new folder button', async () => {
    writable = false
    renderBrowser()
    await screen.findByText('a.png')
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /New folder/ })).toBeNull()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Pencil, Trash2 } from 'lucide-react'

import { DriveGrid, ItemMenu, FileThumb, FolderGlyph, when, VISIBILITY_LABEL } from '@/components/admin/drive/DriveItems'

const file = (o: any = {}) => ({
  id: 'f1', folderId: null, name: 'photo.png', mime: 'image/png', kind: 'image', size: 2048, width: null, height: null, duration: null, blurhash: null,
  source: 'drive', createdAt: '2026-01-05T10:00:00Z', uploadedBy: 'Priya', url: '/f/1', thumbUrl: null, downloadUrl: '/f/1/dl', ...o,
})
const folder = (o: any = {}) => ({ id: 'd1', parentId: null, name: 'Invoices 2026', visibility: 'private', systemKey: null, ownerAdminId: 'a', ownerName: 'Priya', createdAt: '2026-01-01T00:00:00Z', access: 'manage', ...o })

describe('when', () => {
  it('shows the time for today and the date otherwise', () => {
    expect(when(new Date().toISOString())).toMatch(/\d{1,2}:\d{2}/)
    expect(when('2026-01-05T10:00:00Z')).toMatch(/5 Jan 2026/)
  })
})

describe('FileThumb', () => {
  it('shows an image thumbnail and falls back to the kind icon when it breaks', () => {
    const { container } = render(<FileThumb f={file() as any} />)
    const img = container.querySelector('img')!
    expect(img).toHaveAttribute('src', '/f/1')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('png')).toBeInTheDocument()
  })

  it('uses thumbUrl and marks a video, and shows the extension for a pdf', () => {
    const { container, rerender } = render(<FileThumb f={file({ kind: 'video', name: 'clip.mp4', thumbUrl: '/t/1' }) as any} />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/t/1')
    expect(container.querySelector('svg')).not.toBeNull()
    rerender(<FileThumb f={file({ kind: 'pdf', name: 'invoice.pdf' }) as any} />)
    expect(screen.getByText('pdf')).toBeInTheDocument()
  })
})

describe('FolderGlyph', () => {
  it('renders without throwing for private, team and gallery folders', () => {
    const { container, rerender } = render(<FolderGlyph f={folder() as any} />)
    expect(container.querySelectorAll('svg')).toHaveLength(2)
    rerender(<FolderGlyph f={folder({ visibility: 'team' }) as any} />)
    expect(container.querySelectorAll('svg')).toHaveLength(2)
    rerender(<FolderGlyph f={folder({ visibility: 'shared' }) as any} />)
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    rerender(<FolderGlyph f={folder({ id: 'gallery' }) as any} />)
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })
})

describe('ItemMenu', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<ItemMenu items={[false, null, undefined]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens a menu, runs an item and closes, with danger styling', () => {
    const rename = vi.fn()
    const del = vi.fn()
    render(<ItemMenu items={[{ label: 'Rename', icon: Pencil, onClick: rename }, false, { label: 'Delete', icon: Trash2, onClick: del, danger: true }]} />)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('text-red-600')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(rename).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape and on an outside click', () => {
    render(<ItemMenu items={[{ label: 'Rename', icon: Pencil, onClick: () => {} }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('DriveGrid grid view', () => {
  it('lists folders and files with their details', () => {
    render(<DriveGrid folders={[folder({ fileCount: 1 }) as any, folder({ id: 'd2', name: 'System', systemKey: 'x', visibility: 'team' }) as any]} files={[file() as any]} onFolder={() => {}} onFile={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument()
    expect(screen.getByText('Invoices 2026')).toBeInTheDocument()
    expect(screen.getByText('Owner: Priya · 1 item')).toBeInTheDocument()
    expect(screen.getByText('System folder')).toBeInTheDocument()
    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.getByText(/2\.0 KB · 5 Jan 2026/)).toBeInTheDocument()
  })

  it('opens a folder with a click and with Enter', () => {
    const onFolder = vi.fn()
    render(<DriveGrid folders={[folder() as any]} files={[]} onFolder={onFolder} onFile={() => {}} />)
    const tile = screen.getByRole('button', { name: /Invoices 2026/ })
    fireEvent.click(tile)
    fireEvent.keyDown(tile, { key: 'Enter' })
    expect(onFolder).toHaveBeenCalledTimes(2)
  })

  it('selects a file on click and double click opens it', () => {
    const onFile = vi.fn()
    const onFileOpen = vi.fn()
    render(<DriveGrid folders={[]} files={[file() as any]} onFolder={() => {}} onFile={onFile} onFileOpen={onFileOpen} />)
    const tile = screen.getByRole('button', { name: /photo\.png/ })
    fireEvent.click(tile)
    expect(onFile).toHaveBeenCalledTimes(1)
    fireEvent.doubleClick(tile)
    expect(onFileOpen).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(tile, { key: ' ' })
    expect(onFile).toHaveBeenCalledTimes(2)
  })

  it('marks selected files, and the tick toggles without opening', () => {
    const onFile = vi.fn()
    const onCheck = vi.fn()
    render(<DriveGrid folders={[]} files={[file() as any, file({ id: 'f2', name: 'b.png' }) as any]} selected={new Set(['f1'])} onFolder={() => {}} onFile={onFile} onCheck={onCheck} />)
    expect(screen.getByRole('button', { name: /photo\.png/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /b\.png/ })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select b.png' }))
    expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'f2' }))
    expect(onFile).not.toHaveBeenCalled()
  })

  it('greys out a blocked file with its reason and ignores clicks', () => {
    const onFile = vi.fn()
    render(<DriveGrid folders={[]} files={[file() as any]} onFolder={() => {}} onFile={onFile} blocked={() => 'Larger than 5 MB'} />)
    const tile = screen.getByTitle('Larger than 5 MB')
    expect(tile).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(tile)
    expect(onFile).not.toHaveBeenCalled()
  })

  it('renders folder and file menus', () => {
    render(<DriveGrid folders={[folder() as any]} files={[file() as any]} onFolder={() => {}} onFile={() => {}} folderMenu={f => <span>menu {f.name}</span>} fileMenu={f => <span>menu {f.name}</span>} />)
    expect(screen.getByText('menu Invoices 2026')).toBeInTheDocument()
    expect(screen.getByText('menu photo.png')).toBeInTheDocument()
  })
})

describe('DriveGrid list view', () => {
  it('shows a table with owner column, sizes and the deleted heading in the trash', () => {
    const files = [file({ deletedAt: '2026-01-06T10:00:00Z' }) as any, file({ id: 'f2', name: 'inv.pdf', kind: 'pdf', size: 0, meta: 'Acme · ₹500', source: 'document' }) as any]
    render(<DriveGrid folders={[]} files={files} view="list" showOwner ownerLabel="Customer" onFolder={() => {}} onFile={() => {}} />)
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Customer' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Deleted' })).toBeInTheDocument()
    expect(within(table).getByText('2.0 KB')).toBeInTheDocument()
    expect(within(table).getByText('₹500')).toBeInTheDocument()
  })

  it('clicking a row selects it and a blocked row ignores clicks', () => {
    const onFile = vi.fn()
    render(<DriveGrid folders={[]} files={[file() as any, file({ id: 'f2', name: 'big.mp4', kind: 'video' }) as any]} view="list" onFolder={() => {}} onFile={onFile} blocked={f => (f.id === 'f2' ? 'Too big' : null)} />)
    fireEvent.click(screen.getByText('photo.png'))
    expect(onFile).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('big.mp4'))
    expect(onFile).toHaveBeenCalledTimes(1)
    expect(screen.getByText('big.mp4').closest('tr')).toHaveAttribute('title', 'Too big')
  })
})

describe('VISIBILITY_LABEL', () => {
  it('describes each visibility', () => {
    expect(VISIBILITY_LABEL.private).toMatch(/Only you/)
    expect(VISIBILITY_LABEL.team).toMatch(/Everyone/)
    expect(VISIBILITY_LABEL.shared).toMatch(/share/)
  })
})

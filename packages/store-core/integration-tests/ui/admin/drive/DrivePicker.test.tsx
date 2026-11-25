import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react'

const list = vi.fn()
const upload = vi.fn()
vi.mock('@/components/admin/drive/api', () => ({
  driveApi: { list: (...a: any[]) => list(...a) },
  uploadDriveFile: (...a: any[]) => upload(...a),
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="Type" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
const toast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast: toast }) }))

import DrivePicker, { useDrivePicker, KIND_OPTIONS } from '@/components/admin/drive/DrivePicker'

const file = (id: string, o: any = {}) => ({
  id, folderId: null, name: `${id}.png`, mime: 'image/png', kind: 'image', size: 1024, width: null, height: null, duration: null, blurhash: null,
  source: 'drive', createdAt: '2026-01-05T10:00:00Z', uploadedBy: 'Priya', url: `/f/${id}`, thumbUrl: null, downloadUrl: `/f/${id}/dl`, ...o,
})
const folder = (id: string, name: string) => ({ id, parentId: null, name, visibility: 'private', systemKey: null, ownerAdminId: 'a', ownerName: 'Priya', createdAt: '', access: 'edit' })
const listing = (o: any = {}) => ({ folder: null, folders: [folder('d1', 'Docs')], files: [file('a'), file('b')], total: 2, path: [], ...o })

beforeEach(() => {
  list.mockReset()
  upload.mockReset()
  toast.mockReset()
  list.mockResolvedValue(listing())
})
afterEach(() => vi.useRealTimers())

describe('DrivePicker', () => {
  it('shows a loading state and then folders and files', async () => {
    render(<DrivePicker onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('status', { name: 'Loading files' })).toBeInTheDocument()
    expect(await screen.findByText('a.png')).toBeInTheDocument()
    expect(screen.getByText('Docs')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Choose from Drive' })).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith({ folder: 'root', q: '', kind: '' }, expect.any(AbortSignal))
  })

  it('multi select: toggles files, counts them and attaches', async () => {
    const onPick = vi.fn()
    render(<DrivePicker onPick={onPick} onClose={() => {}} max={3} />)
    await screen.findByText('a.png')
    expect(screen.getByText('Pick up to 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /a\.png/ }))
    fireEvent.click(screen.getByRole('button', { name: /b\.png/ }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /a\.png/ }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Attach 1 file' }))
    expect(onPick).toHaveBeenCalledWith([expect.objectContaining({ id: 'b' })])
  })

  it('caps the selection at max', async () => {
    render(<DrivePicker onPick={() => {}} onClose={() => {}} max={1} />)
    await screen.findByText('a.png')
    fireEvent.click(screen.getByRole('button', { name: /a\.png/ }))
    fireEvent.click(screen.getByRole('button', { name: /b\.png/ }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('single select picks on click with no footer, and honours a custom confirm label', async () => {
    const onPick = vi.fn()
    const { unmount } = render(<DrivePicker multiple={false} onPick={onPick} onClose={() => {}} />)
    await screen.findByText('a.png')
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /a\.png/ }))
    expect(onPick).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })])
    unmount()
    render(<DrivePicker confirmLabel="Use these" onPick={() => {}} onClose={() => {}} />)
    await screen.findByText('a.png')
    expect(screen.getByRole('button', { name: 'Use these' })).toBeInTheDocument()
  })

  it('greys out files of the wrong kind or too large, with the reason and a hint', async () => {
    list.mockResolvedValue(listing({ files: [file('a'), file('doc', { kind: 'pdf', name: 'x.pdf' }), file('big', { size: 10 * 1024 * 1024 })] }))
    render(<DrivePicker kinds={['image']} maxBytes={5 * 1024 * 1024} onPick={() => {}} onClose={() => {}} />)
    await screen.findByText('a.png')
    expect(screen.getByText('Only images, up to 5.0 MB')).toBeInTheDocument()
    expect(screen.getByTitle('This type can’t be used here')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTitle('Larger than 5.0 MB')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('image')
  })

  it('limits the type filter to the allowed kinds', async () => {
    render(<DrivePicker kinds={['image', 'pdf']} onPick={() => {}} onClose={() => {}} />)
    await screen.findByText('a.png')
    const labels = Array.from(screen.getByRole('combobox', { name: 'Type' }).querySelectorAll('option')).map(o => o.textContent)
    expect(labels).toEqual(['All types', 'Images', 'PDFs'])
    expect(KIND_OPTIONS.length).toBe(7)
  })

  it('opens a folder from the grid and goes back from the crumbs', async () => {
    list.mockImplementation(async ({ folder: f }: any) => (f === 'd1' ? listing({ folder: folder('d1', 'Docs'), folders: [], files: [file('inside')], path: [{ id: 'd1', name: 'Docs' }] }) : listing()))
    render(<DrivePicker onPick={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Docs/ }))
    expect(await screen.findByText('inside.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Docs', current: 'page' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Drive' }))
    expect(await screen.findByText('a.png')).toBeInTheDocument()
  })

  it('debounces the search and reloads with the query', async () => {
    render(<DrivePicker onPick={() => {}} onClose={() => {}} />)
    await screen.findByText('a.png')
    list.mockClear()
    fireEvent.change(screen.getByPlaceholderText('Search all files'), { target: { value: ' inv ' } })
    expect(list).not.toHaveBeenCalled()
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ q: 'inv' }), expect.any(AbortSignal)))
  })

  it('shows empty-search and empty-folder messages', async () => {
    list.mockResolvedValue(listing({ folders: [], files: [] }))
    render(<DrivePicker onPick={() => {}} onClose={() => {}} />)
    expect(await screen.findByText('Nothing here yet. Upload a file to use it.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search all files'), { target: { value: 'zzz' } })
    expect(await screen.findByText('No files match your search.')).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    list.mockRejectedValue(new Error('Drive offline'))
    render(<DrivePicker onPick={() => {}} onClose={() => {}} />)
    expect(await screen.findByText('Drive offline')).toBeInTheDocument()
  })

  it('Show more appends the next page', async () => {
    list.mockResolvedValueOnce(listing({ total: 3 })).mockResolvedValueOnce(listing({ files: [file('c')], total: 3 }))
    render(<DrivePicker onPick={() => {}} onClose={() => {}} />)
    await screen.findByText('a.png')
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('c.png')).toBeInTheDocument()
    expect(list).toHaveBeenLastCalledWith({ folder: 'root', q: '', kind: '', page: 1 })
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('uploads into the folder, selects the new file and refreshes', async () => {
    upload.mockResolvedValue({ file: file('new') })
    const onPick = vi.fn()
    const { container } = render(<DrivePicker onPick={onPick} onClose={() => {}} />)
    await screen.findByText('a.png')
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement
    const f = new File(['x'], 'new.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [f] } })
    await waitFor(() => expect(upload).toHaveBeenCalledWith(f, null, expect.any(Function)))
    expect(await screen.findByText('1 selected')).toBeInTheDocument()
  })

  it('a single-select upload picks it straight away, and a failed upload toasts', async () => {
    upload.mockResolvedValueOnce({ file: file('new') }).mockRejectedValueOnce(new Error('Too big'))
    const onPick = vi.fn()
    const { container } = render(<DrivePicker multiple={false} onPick={onPick} onClose={() => {}} />)
    await screen.findByText('a.png')
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } })
    await waitFor(() => expect(onPick).toHaveBeenCalledWith([expect.objectContaining({ id: 'new' })]))
    fireEvent.change(input, { target: { files: [new File(['x'], 'bad.png', { type: 'image/png' })] } })
    await waitFor(() => expect(toast).toHaveBeenCalledWith('bad.png: Too big', 'error'))
  })

  it('Cancel closes', async () => {
    const onClose = vi.fn()
    render(<DrivePicker onPick={() => {}} onClose={onClose} />)
    await screen.findByText('a.png')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('useDrivePicker', () => {
  function Harness({ result }: { result: (v: any) => void }) {
    const { pick, node } = useDrivePicker()
    return (
      <>
        <button onClick={async () => result(await pick({ title: 'Attach it', multiple: false }))}>open</button>
        {node}
      </>
    )
  }

  it('resolves with the picked files', async () => {
    const result = vi.fn()
    render(<Harness result={result} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByText('open'))
    expect(await screen.findByRole('dialog', { name: 'Attach it' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /a\.png/ }))
    await waitFor(() => expect(result).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves null when closed', async () => {
    const result = vi.fn()
    render(<Harness result={result} />)
    fireEvent.click(screen.getByText('open'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(result).toHaveBeenCalledWith(null))
  })

  it('exposes pick as a stable callback', () => {
    const { result, rerender } = renderHook(() => useDrivePicker())
    const first = result.current.pick
    rerender()
    expect(result.current.pick).toBe(first)
    act(() => {
      void result.current.pick()
    })
    expect(result.current.node).not.toBeNull()
  })
})

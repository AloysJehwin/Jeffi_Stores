import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import DigitalFilesPanel from '@/components/admin/DigitalFilesPanel'

const file = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  kind: 'video',
  status: 'ready',
  downloadable: false,
  display_name: 'lesson-1.mp4',
  mime_type: 'video/mp4',
  size_bytes: String(5 * 1024 * 1024),
  created_at: '2026-01-01T00:00:00Z',
  draft_id: null,
  ...over,
})

const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })

describe('DigitalFilesPanel', () => {
  let files: ReturnType<typeof file>[]
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    files = [file()]
    confirm.mockResolvedValue(true)
    fetchMock = vi.fn<(...a: any[]) => any>().mockImplementation(async (_url: string, init?: any) => {
      if (!init) return json(true, { files })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows Loading, then the files with kind, size and downloadable state', async () => {
    render(<DigitalFilesPanel productId="p1" />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('lesson-1.mp4')).toBeInTheDocument()
    expect(screen.getByText('video')).toBeInTheDocument()
    expect(screen.getByText('5.0 MB')).toBeInTheDocument()
    expect(screen.getByLabelText('Downloadable')).not.toBeChecked()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/files')
  })

  it('shows the empty state and a draft hint when editing a draft', async () => {
    files = []
    render(<DigitalFilesPanel productId="p1" draftId="d1" />)
    expect(await screen.findByText(/No files yet/)).toBeInTheDocument()
    expect(screen.getByText(/apply when the draft is published/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/files?draft=d1')
  })

  it('flags files that live in a draft', async () => {
    files = [file({ draft_id: 'd1' })]
    render(<DigitalFilesPanel productId="p1" draftId="d1" />)
    expect(await screen.findByText('In draft')).toBeInTheDocument()
  })

  it('uploads through reserve, PUT and complete, then reloads', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (!init) return json(true, { files })
      if (url === 'https://up.test/x') return json(true)
      const body = JSON.parse(init.body)
      if (body.action === 'reserve') return json(true, { upload_url: 'https://up.test/x', mime_type: 'video/mp4', session_id: 's1' })
      return json(true, {})
    })
    const { container } = render(<DigitalFilesPanel productId="p1" />)
    await screen.findByText('lesson-1.mp4')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const f = new File(['abc'], 'new.mp4', { type: 'video/mp4' })
    fireEvent.change(input, { target: { files: [f] } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('File uploaded', 'success'))
    const bodies = fetchMock.mock.calls.filter(c => c[1]?.method === 'POST').map(c => JSON.parse(c[1].body))
    expect(bodies[0]).toMatchObject({ action: 'reserve', display_name: 'new.mp4', declared_bytes: 3 })
    expect(bodies[1]).toEqual({ action: 'complete', session_id: 's1' })
    expect(fetchMock.mock.calls.some(c => c[0] === 'https://up.test/x' && c[1].method === 'PUT')).toBe(true)
  })

  it('toasts the reservation error', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) =>
      !init ? json(true, { files }) : json(false, { error: 'Quota exceeded' })
    )
    const { container } = render(<DigitalFilesPanel productId="p1" />)
    await screen.findByText('lesson-1.mp4')
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'a.pdf')] } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Quota exceeded', 'error'))
  })

  it('toasts when the storage upload fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (!init) return json(true, { files })
      if (url === 'https://up.test/x') return json(false)
      return json(true, { upload_url: 'https://up.test/x', mime_type: 'a', session_id: 's' })
    })
    const { container } = render(<DigitalFilesPanel productId="p1" />)
    await screen.findByText('lesson-1.mp4')
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'a.pdf')] } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Upload failed', 'error'))
  })

  it('toggles downloadable optimistically with a PATCH', async () => {
    render(<DigitalFilesPanel productId="p1" />)
    const box = await screen.findByLabelText('Downloadable')
    fireEvent.click(box)
    expect(box).toBeChecked()
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({ file_id: 'f1', downloadable: true })
  })

  it('reverts the toggle and toasts when the PATCH fails', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (!init ? json(true, { files }) : json(false)))
    render(<DigitalFilesPanel productId="p1" />)
    const box = await screen.findByLabelText('Downloadable')
    fireEvent.click(box)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not update', 'error'))
    expect(box).not.toBeChecked()
  })

  it('deletes after confirming', async () => {
    render(<DigitalFilesPanel productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('lesson-1.mp4')).toBeNull())
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete file', variant: 'danger' }))
    expect(fetchMock.mock.calls.find(c => c[1]?.method === 'DELETE')![0]).toBe('/api/admin/products/p1/files?file_id=f1')
    expect(showToast).toHaveBeenCalledWith('File deleted', 'success')
  })

  it('keeps the file when the delete is declined', async () => {
    confirm.mockResolvedValue(false)
    render(<DigitalFilesPanel productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(screen.getByText('lesson-1.mp4')).toBeInTheDocument()
  })

  it('toasts when the delete fails', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (!init ? json(true, { files }) : json(false)))
    render(<DigitalFilesPanel productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not delete', 'error'))
  })

  it('is read only without vault write access', async () => {
    canWrite = false
    render(<DigitalFilesPanel productId="p1" />)
    await screen.findByText('lesson-1.mp4')
    expect(screen.queryByRole('button', { name: 'Upload file' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.getByLabelText('Downloadable')).toBeDisabled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))
let scopeWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => scopeWrite }))
vi.mock('@/components/admin/NoteAttachments', () => ({
  default: ({ attachments }: any) => <div data-testid="att">{attachments.length} attachments</div>,
}))

import CustomerNotes from '@/components/admin/CustomerNotes'
import { NOTE_TAGS } from '@/lib/shared/customer-notes-shared'

const note = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  userId: 'u1',
  body: 'Prefers morning delivery',
  title: 'Delivery',
  tags: ['vip'],
  orderId: null,
  orderNumber: 'ORD-77',
  returnRequestId: null,
  sharedWithCustomer: false,
  source: 'admin',
  createdAt: '2026-02-03T10:00:00Z',
  adminId: 'a1',
  adminUsername: 'asha',
  attachments: [],
  ...over,
})

const res = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })

describe('CustomerNotes', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    scopeWrite = true
    confirm.mockResolvedValue(true)
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(res(true, { notes: [] }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the empty state', () => {
    render(<CustomerNotes customerId="c1" initialNotes={[]} />)
    expect(screen.getByText('No notes yet.')).toBeInTheDocument()
  })

  it('lists notes with title, body, tags, order, author and attachments', () => {
    render(<CustomerNotes customerId="c1" initialNotes={[note({ sharedWithCustomer: true, source: 'staff_form', returnRequestId: 'r1' }) as any]} />)
    expect(screen.getByText('Delivery')).toBeInTheDocument()
    expect(screen.getByText('Prefers morning delivery')).toBeInTheDocument()
    expect(screen.getByText('vip')).toBeInTheDocument()
    expect(screen.getByText('Order ORD-77')).toBeInTheDocument()
    expect(screen.getByText('shared with customer')).toBeInTheDocument()
    expect(screen.getByText('staff form')).toBeInTheDocument()
    expect(screen.getByText('return')).toBeInTheDocument()
    expect(screen.getByText(/asha/)).toBeInTheDocument()
    expect(screen.getByTestId('att')).toBeInTheDocument()
  })

  it('is read only without the canWrite prop', () => {
    render(<CustomerNotes customerId="c1" initialNotes={[note() as any]} />)
    expect(screen.queryByPlaceholderText(/Write a note/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('is read only without the customers:write scope even when canWrite is passed', () => {
    scopeWrite = false
    render(<CustomerNotes customerId="c1" initialNotes={[note() as any]} canWrite />)
    expect(screen.queryByPlaceholderText(/Write a note/)).toBeNull()
  })

  it('keeps Add Note disabled until there is content', () => {
    render(<CustomerNotes customerId="c1" initialNotes={[]} canWrite />)
    const add = screen.getByRole('button', { name: 'Add Note' })
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/Write a note/), { target: { value: 'hello' } })
    expect(add).toBeEnabled()
  })

  it('posts a multipart note with tags, order link and share flag, then reloads and clears the form', async () => {
    fetchMock
      .mockResolvedValueOnce(res(true, {}))
      .mockResolvedValueOnce(res(true, { notes: [note({ id: 'n9', title: 'Fresh', body: '' })] }))
    render(<CustomerNotes customerId="c1" initialNotes={[]} canWrite orderId="o5" />)
    fireEvent.change(screen.getByPlaceholderText('Title (optional)'), { target: { value: ' Fresh ' } })
    fireEvent.change(screen.getByPlaceholderText(/Write a note/), { target: { value: ' body text ' } })
    fireEvent.click(screen.getByRole('button', { name: NOTE_TAGS[0] }))
    fireEvent.click(screen.getByLabelText('Share with customer'))
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))
    expect(await screen.findByText('Fresh')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/customers/c1/notes')
    expect(init.method).toBe('POST')
    const fd = init.body as FormData
    expect(fd.get('title')).toBe('Fresh')
    expect(fd.get('body')).toBe('body text')
    expect(fd.getAll('tags')).toEqual([NOTE_TAGS[0]])
    expect(fd.get('orderId')).toBe('o5')
    expect(fd.get('shared')).toBe('true')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/customers/c1/notes?orderId=o5')
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Title (optional)')).toHaveValue('')
  })

  it('toasts the API error when saving fails', async () => {
    fetchMock.mockResolvedValue(res(false, { error: 'Too long' }))
    render(<CustomerNotes customerId="c1" initialNotes={[]} canWrite />)
    fireEvent.change(screen.getByPlaceholderText(/Write a note/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Too long', 'error'))
  })

  it('warns about skipped attachments', async () => {
    fetchMock.mockResolvedValueOnce(res(true, { warnings: ['a.png too big'] })).mockResolvedValueOnce(res(true, { notes: [] }))
    render(<CustomerNotes customerId="c1" initialNotes={[]} canWrite />)
    fireEvent.change(screen.getByPlaceholderText(/Write a note/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('a.png too big'), 'warning'))
  })

  it('shows how many files are selected', () => {
    const { container } = render(<CustomerNotes customerId="c1" initialNotes={[]} canWrite />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const f = (n: string) => new File(['x'], n, { type: 'image/png' })
    fireEvent.change(input, { target: { files: [f('a.png'), f('b.png')] } })
    expect(screen.getByText('2 files selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Note' })).toBeEnabled()
  })

  it('deletes a note after confirming', async () => {
    render(<CustomerNotes customerId="c1" initialNotes={[note() as any]} canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Delivery')).toBeNull())
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger', confirmLabel: 'Delete' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/customers/c1/notes?noteId=n1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('keeps the note when the delete confirm is declined', async () => {
    confirm.mockResolvedValue(false)
    render(<CustomerNotes customerId="c1" initialNotes={[note() as any]} canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('Delivery')).toBeInTheDocument()
  })

  it('shares a note after confirming and PATCHes the flag', async () => {
    render(<CustomerNotes customerId="c1" initialNotes={[note() as any]} canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('shared with customer')).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ noteId: 'n1', shared: true })
  })

  it('unshares without a confirm', async () => {
    render(<CustomerNotes customerId="c1" initialNotes={[note({ sharedWithCustomer: true }) as any]} canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Unshare' }))
    await waitFor(() => expect(screen.queryByText('shared with customer')).toBeNull())
    expect(confirm).not.toHaveBeenCalled()
  })

  it('creates a follow-up task from a note', async () => {
    render(<CustomerNotes customerId="c1" initialNotes={[note() as any]} canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Task' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Task created from note.', 'success'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/customers/c1/tasks')
    expect(JSON.parse(init.body)).toEqual({ title: 'Delivery', description: 'Prefers morning delivery', priority: 'medium' })
  })

  it('toasts when task creation fails', async () => {
    fetchMock.mockResolvedValue(res(false, { error: 'No CRM' }))
    render(<CustomerNotes customerId="c1" initialNotes={[note() as any]} canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Task' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No CRM', 'error'))
  })
})

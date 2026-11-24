import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
  useCanWrite: () => canWrite,
}))

import CategoryFaqEditor from '@/components/admin/CategoryFaqEditor'

const faqs = [
  { id: 'f1', question: 'Q one', answer: 'A one', published: true },
  { id: 'f2', question: 'Q two', answer: 'A two', published: false },
]

const ok = (body: unknown) => ({ ok: true, json: async () => body })

describe('CategoryFaqEditor', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(ok({ faqs }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows loading then the loaded FAQs', async () => {
    render(<CategoryFaqEditor categoryId="c1" />)
    expect(screen.getByText(/Loading FAQs/)).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Q one')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A two')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/categories/c1/faqs')
  })

  it('shows the empty state', async () => {
    fetchMock.mockResolvedValue(ok({ faqs: [] }))
    render(<CategoryFaqEditor categoryId="c1" />)
    expect(await screen.findByText(/No FAQs\./)).toBeInTheDocument()
  })

  it('toasts when loading fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<CategoryFaqEditor categoryId="c1" />)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not load FAQs', 'error'))
  })

  it('keeps Save disabled until something changes, then PUTs the edited rows', async () => {
    render(<CategoryFaqEditor categoryId="c1" />)
    await screen.findByDisplayValue('Q one')
    const save = screen.getByRole('button', { name: 'Save FAQs' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByDisplayValue('Q one'), { target: { value: 'Edited' } })
    expect(save).toBeEnabled()
    fetchMock.mockResolvedValue(ok({ faqs: [{ ...faqs[0], question: 'Edited' }, faqs[1]] }))
    fireEvent.click(save)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('FAQs saved', 'success'))
    const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(JSON.parse(put[1].body).faqs[0].question).toBe('Edited')
    expect(screen.getByRole('button', { name: 'Save FAQs' })).toBeDisabled()
  })

  it('adds a blank question row', async () => {
    render(<CategoryFaqEditor categoryId="c1" />)
    await screen.findByDisplayValue('Q one')
    fireEvent.click(screen.getByRole('button', { name: /Add question/ }))
    expect(screen.getAllByPlaceholderText('Question')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Save FAQs' })).toBeEnabled()
  })

  it('removes a row', async () => {
    render(<CategoryFaqEditor categoryId="c1" />)
    await screen.findByDisplayValue('Q one')
    fireEvent.click(screen.getAllByTitle('Remove')[0])
    expect(screen.queryByDisplayValue('Q one')).toBeNull()
  })

  it('reorders rows and disables the edge arrows', async () => {
    render(<CategoryFaqEditor categoryId="c1" />)
    await screen.findByDisplayValue('Q one')
    expect(screen.getAllByTitle('Move up')[0]).toBeDisabled()
    expect(screen.getAllByTitle('Move down')[1]).toBeDisabled()
    fireEvent.click(screen.getAllByTitle('Move down')[0])
    const questions = screen.getAllByPlaceholderText('Question').map(i => (i as HTMLInputElement).value)
    expect(questions).toEqual(['Q two', 'Q one'])
  })

  it('toggles the published checkbox', async () => {
    render(<CategoryFaqEditor categoryId="c1" />)
    await screen.findByDisplayValue('Q one')
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes[0]).toBeChecked()
    expect(boxes[1]).not.toBeChecked()
    fireEvent.click(boxes[1])
    expect(boxes[1]).toBeChecked()
  })

  it('toasts the API error when saving fails', async () => {
    render(<CategoryFaqEditor categoryId="c1" />)
    await screen.findByDisplayValue('Q one')
    fireEvent.change(screen.getByDisplayValue('Q one'), { target: { value: 'x' } })
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Too many FAQs' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Save FAQs' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Too many FAQs', 'error'))
  })

  it('disables editing when disabled', async () => {
    render(<CategoryFaqEditor categoryId="c1" disabled />)
    expect(await screen.findByDisplayValue('Q one')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Add question/ })).toBeDisabled()
  })

  it('hides Save without categories:write', async () => {
    canWrite = false
    render(<CategoryFaqEditor categoryId="c1" />)
    await screen.findByDisplayValue('Q one')
    expect(screen.queryByRole('button', { name: 'Save FAQs' })).toBeNull()
  })
})

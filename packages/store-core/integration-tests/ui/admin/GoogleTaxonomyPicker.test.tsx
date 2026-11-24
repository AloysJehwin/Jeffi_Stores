import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import GoogleTaxonomyPicker from '@/components/admin/GoogleTaxonomyPicker'

const J = (body: unknown, ok = true) => ({ ok, json: async () => body })

function mount(over: Partial<React.ComponentProps<typeof GoogleTaxonomyPicker>> = {}) {
  return render(
    <form>
      <input name="parent_id" defaultValue="parent-1" />
      <GoogleTaxonomyPicker name="google_category" categoryName="Shirts" description="Cotton shirts" {...over} />
    </form>
  )
}

describe('GoogleTaxonomyPicker', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(J({ match: true }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the stored value and submits it under the field name', async () => {
    const { container } = mount({ defaultValue: 'Apparel > Shirts' })
    expect(screen.getByRole('textbox')).toHaveValue('Apparel > Shirts')
    expect(container.querySelector('input[type="hidden"][name="google_category"]')).toHaveValue('Apparel > Shirts')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/categories/google-taxonomy?value=Apparel%20%3E%20Shirts'))
  })

  it('warns when the stored value is not an official category', async () => {
    fetchMock.mockResolvedValue(J({ match: null }))
    mount({ defaultValue: 'Made up' })
    expect(await screen.findByText(/Not an official Google category/)).toBeInTheDocument()
  })

  it('does not validate an empty value', () => {
    mount()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('searches after two characters and lets the user pick a result', async () => {
    fetchMock.mockResolvedValue(J({ results: [{ id: 212, path: 'Apparel > Clothing > Shirts' }] }))
    const { container } = mount()
    const input = screen.getByPlaceholderText(/Search Google categories/)
    fireEvent.change(input, { target: { value: 'sh' } })
    const option = await screen.findByText('Shirts')
    expect(screen.getByText(/#212/)).toBeInTheDocument()
    fireEvent.click(option)
    expect(container.querySelector('input[type="hidden"]')).toHaveValue('Apparel > Clothing > Shirts')
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('?q=sh'))).toBe(true)
  })

  it('does not search for a single character', async () => {
    const { } = mount()
    fireEvent.change(screen.getByPlaceholderText(/Search Google categories/), { target: { value: 's' } })
    await new Promise(r => setTimeout(r, 300))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the selected category', async () => {
    const { container } = mount({ defaultValue: 'Apparel' })
    fireEvent.click(screen.getByLabelText('Clear Google category'))
    expect(container.querySelector('input[type="hidden"]')).toHaveValue('')
  })

  it('auto-matches from the category name with the parent id from the form', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) =>
      init?.method === 'POST' ? J({ match: { path: 'Apparel > Shirts' } }) : J({ match: true })
    )
    const { container } = mount()
    fireEvent.click(screen.getByRole('button', { name: /Auto-match/ }))
    await waitFor(() => expect(container.querySelector('input[type="hidden"]')).toHaveValue('Apparel > Shirts'))
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ name: 'Shirts', description: 'Cotton shirts', parent_id: 'parent-1' })
  })

  it('shows a message when nothing matches', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? J({ match: null }) : J({})))
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Auto-match/ }))
    expect(await screen.findByText(/No matching Google category found/)).toBeInTheDocument()
  })

  it('shows the API error from auto-match', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? J({ error: 'AI down' }, false) : J({})))
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Auto-match/ }))
    expect(await screen.findByText('AI down')).toBeInTheDocument()
  })

  it('disables auto-match without a category name', () => {
    mount({ categoryName: '  ' })
    expect(screen.getByRole('button', { name: /Auto-match/ })).toBeDisabled()
  })

  it('hides auto-match without categories:write', () => {
    canWrite = false
    mount()
    expect(screen.queryByRole('button', { name: /Auto-match/ })).toBeNull()
  })
})

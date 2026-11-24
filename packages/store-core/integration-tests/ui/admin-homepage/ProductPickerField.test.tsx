import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ProductPickerField from '@/components/admin/homepage/editors/ProductPickerField'
import { PRODUCTS, P1, P2, stubProductFetch } from './editor-kit'

// ProductPickerField: shows the products behind the saved ids, and searches the catalogue (debounced, 2+
// characters) to add or replace them. fetch is stubbed; no network.
function setup(props: Partial<React.ComponentProps<typeof ProductPickerField>> = {}) {
  const onCommit = vi.fn<(...a: any[]) => any>()
  const utils = render(<ProductPickerField label="Pick" ids={[]} disabled={false} onCommit={onCommit} {...props} />)
  return { onCommit, ...utils }
}

describe('ProductPickerField', () => {
  let fetchMock: ReturnType<typeof stubProductFetch>
  beforeEach(() => {
    fetchMock = stubProductFetch()
  })

  it('loads and lists the products for the saved ids, with their SKU', async () => {
    setup({ ids: [P1, P2], multiple: true })
    expect(await screen.findByText('Cordless Drill')).toBeInTheDocument()
    expect(screen.getByText('Drill Bit Set')).toBeInTheDocument()
    expect(screen.getByText('DRL-1')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`ids=${P1}%2C${P2}`), { credentials: 'include' })
  })

  it('does not fetch anything for an empty selection', () => {
    setup()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Search products by name or SKU')).toBeInTheDocument()
  })

  it('removes a product by committing the remaining ids', async () => {
    const { onCommit } = setup({ ids: [P1, P2], multiple: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Cordless Drill' }))
    expect(onCommit).toHaveBeenCalledWith([P2])
  })

  it('does not search for fewer than two characters', async () => {
    setup()
    fireEvent.change(screen.getByPlaceholderText(/Search products/), { target: { value: 'd' } })
    await new Promise(r => setTimeout(r, 350))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('searches after the debounce and commits a single pick, replacing the selection', async () => {
    const { onCommit } = setup({ ids: [P1] })
    await screen.findByText('Cordless Drill')
    const box = screen.getByPlaceholderText('Search to replace this product')
    fireEvent.change(box, { target: { value: 'bit' } })
    const result = await screen.findByRole('button', { name: /Drill Bit Set/ })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=bit'), { credentials: 'include' })
    expect(screen.getByText('Bundle')).toBeInTheDocument()
    fireEvent.click(result)
    expect(onCommit).toHaveBeenCalledWith([P2])
    expect(box).toHaveValue('')
  })

  it('appends a pick in multiple mode and disables already-chosen results', async () => {
    const { onCommit } = setup({ ids: [P1], multiple: true })
    await screen.findByText('Cordless Drill')
    fireEvent.change(screen.getByPlaceholderText('Search products by name or SKU'), { target: { value: 'dri' } })
    const chosen = await screen.findByRole('button', { name: /^Cordless Drill$/ })
    expect(chosen).toBeDisabled()
    fireEvent.click(await screen.findByRole('button', { name: /Drill Bit Set/ }))
    expect(onCommit).toHaveBeenCalledWith([P1, P2])
  })

  it('hides the search box once the maximum is reached', async () => {
    setup({ ids: [P1, P2], multiple: true, max: 2 })
    await screen.findByText('Cordless Drill')
    expect(screen.queryByPlaceholderText(/Search products/)).toBeNull()
  })

  it('tolerates a failed lookup by showing nothing', async () => {
    fetchMock.mockImplementation((async () => ({ ok: false, json: async () => ({}) })) as any)
    setup()
    fireEvent.change(screen.getByPlaceholderText(/Search products/), { target: { value: 'drill' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Cordless/ })).toBeNull()
  })

  it('shows the hint and disables search and removal when disabled', async () => {
    setup({ ids: [P1], hint: 'Pick one', disabled: true })
    expect(screen.getByText('Pick one')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Remove Cordless Drill' })).toBeDisabled()
    expect(screen.getByPlaceholderText(/Search to replace/)).toBeDisabled()
  })

  it('clears the list when the ids are emptied', async () => {
    const { rerender } = setup({ ids: [P1] })
    await screen.findByText('Cordless Drill')
    rerender(<ProductPickerField label="Pick" ids={[]} disabled={false} onCommit={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Cordless Drill')).toBeNull())
    expect(PRODUCTS).toHaveLength(2)
  })
})

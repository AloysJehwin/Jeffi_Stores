import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import AdminTypeahead from '@/components/admin/AdminTypeahead'

const items = [
  { id: '1', label: 'Blue Shirt', sublabel: 'SKU-1', href: '/admin/products/1' },
  { id: '2', label: 'Blue Jeans' },
]

function Harness(props: { onSelect?: any; onEnter?: any; initial?: string; disabled?: boolean }) {
  const [v, setV] = useState(props.initial ?? '')
  return (
    <AdminTypeahead type="products" value={v} onChange={setV} onSelect={props.onSelect} onEnter={props.onEnter} placeholder="Search" disabled={props.disabled} />
  )
}

describe('AdminTypeahead', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ items }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  async function typeAndOpen(text = 'blue') {
    const input = screen.getByPlaceholderText('Search')
    fireEvent.change(input, { target: { value: text } })
    await screen.findByText('SKU-1')
    return input
  }

  it('does not search for fewer than two characters', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'b' } })
    await new Promise(r => setTimeout(r, 250))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('debounces, requests the suggest endpoint and lists the results with highlighting', async () => {
    render(<Harness />)
    await typeAndOpen('blue')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/suggest?type=products&q=blue')
    expect(screen.getAllByText('Blue', { selector: 'mark' }).length).toBeGreaterThan(0)
    expect(screen.getByText('SKU-1')).toBeInTheDocument()
  })

  it('selects an item with the mouse and closes the list', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await typeAndOpen()
    fireEvent.mouseDown(screen.getByText('SKU-1').closest('button')!)
    expect(onSelect).toHaveBeenCalledWith(items[0])
    expect(screen.queryByText('SKU-1')).toBeNull()
  })

  it('arrow keys preview items into the input and Enter selects the active one', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const input = await typeAndOpen()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('Blue Shirt')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('Blue Jeans')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })

  it('ArrowUp past the first item restores the typed text', async () => {
    render(<Harness />)
    const input = await typeAndOpen('blue')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('blue')
  })

  it('Enter with no active item runs onEnter with the text', async () => {
    const onEnter = vi.fn()
    render(<Harness onEnter={onEnter} />)
    const input = await typeAndOpen('blue')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEnter).toHaveBeenCalledWith('blue')
  })

  it('Enter while closed runs onEnter', () => {
    const onEnter = vi.fn()
    render(<Harness onEnter={onEnter} initial="x" />)
    fireEvent.keyDown(screen.getByPlaceholderText('Search'), { key: 'Enter' })
    expect(onEnter).toHaveBeenCalledWith('x')
  })

  it('Escape closes the list and restores the typed text', async () => {
    render(<Harness />)
    const input = await typeAndOpen('blue')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('blue')
    expect(screen.queryByText('SKU-1')).toBeNull()
  })

  it('closes on an outside click', async () => {
    render(<Harness />)
    await typeAndOpen()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('SKU-1')).toBeNull()
  })

  it('shows no list when the API returns nothing or fails', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) })
    render(<Harness />)
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'zzz' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('swallows request errors', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    render(<Harness />)
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'zzz' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('can be disabled', () => {
    render(<Harness disabled />)
    expect(screen.getByPlaceholderText('Search')).toBeDisabled()
  })
})

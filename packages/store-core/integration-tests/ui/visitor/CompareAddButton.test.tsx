import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import CompareAddButton from '@/components/visitor/CompareAddButton'

const fetchMock = vi.fn()
const result = (over: Record<string, any> = {}) => ({
  id: 'p9', name: 'Gamma', slug: 'gamma', price: 1500, mrp: 2000, image_url: '/g.png', thumbnail_url: null,
  brand_name: 'Halo', category_id: 'c1', ...over,
})

async function type(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Search product to add…'), { target: { value } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('CompareAddButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.useRealTimers())

  it('toggles the search popover with a hint', () => {
    render(<CompareAddButton currentIds={['a']} categoryId="c1" />)
    expect(screen.queryByPlaceholderText('Search product to add…')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))
    expect(screen.getByText('Type at least 2 characters to search.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))
    expect(screen.queryByPlaceholderText('Search product to add…')).not.toBeInTheDocument()
  })

  it('does not search below 2 characters', async () => {
    render(<CompareAddButton currentIds={[]} categoryId={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))
    await type('a')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('debounces, sends category + exclusions, and lists results with the same-category badge', async () => {
    fetchMock.mockResolvedValue({ json: async () => [result(), result({ id: 'p8', name: 'Delta', category_id: 'c2', brand_name: null, image_url: null })] })
    render(<CompareAddButton currentIds={['a', 'b']} categoryId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))
    await type('gam')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('q=gam')
    expect(url).toContain('categoryId=c1')
    expect(url).toContain('excludeId=a&excludeId=b')
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.getByText(/Halo ·/)).toBeInTheDocument()
    expect(screen.getAllByText(/1,500\.00/)).toHaveLength(2)
    expect(screen.getAllByText('Same cat')).toHaveLength(1)
  })

  it('navigates with the picked id appended and closes', async () => {
    fetchMock.mockResolvedValue({ json: async () => [result()] })
    render(<CompareAddButton currentIds={['a', 'b']} categoryId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))
    await type('gam')
    fireEvent.mouseDown(screen.getByText('Gamma'))
    expect(push).toHaveBeenCalledWith('/compare?ids=a,b,p9')
    expect(screen.queryByPlaceholderText('Search product to add…')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing matches and survives a failed request', async () => {
    fetchMock.mockResolvedValue({ json: async () => [] })
    render(<CompareAddButton currentIds={[]} categoryId={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))
    await type('zzz')
    expect(screen.getByText('No products found.')).toBeInTheDocument()
    fetchMock.mockRejectedValue(new Error('boom'))
    await type('zzzz')
    expect(screen.getByText('No products found.')).toBeInTheDocument()
  })

  it('closes on an outside mousedown', () => {
    render(<CompareAddButton currentIds={[]} categoryId={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByPlaceholderText('Search product to add…')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import CompareChangeButton from '@/components/visitor/CompareChangeButton'

const fetchMock = vi.fn()
const result = (over: Record<string, any> = {}) => ({
  id: 'p9', name: 'Gamma', slug: 'gamma', price: 1500, mrp: null, image_url: null, thumbnail_url: '/t.png',
  brand_name: 'Halo', category_name: 'Audio', category_id: 'c1', ...over,
})

async function type(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Search product…'), { target: { value } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('CompareChangeButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.useRealTimers())

  it('opens the popover with a hint and closes on outside mousedown', () => {
    render(<CompareChangeButton productId="b" currentIds={['a', 'b']} categoryId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByText('Type at least 2 characters to search.')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByPlaceholderText('Search product…')).not.toBeInTheDocument()
  })

  it('excludes the other compared products but not the one being replaced', async () => {
    fetchMock.mockResolvedValue({ json: async () => [result()] })
    render(<CompareChangeButton productId="b" currentIds={['a', 'b', 'c']} categoryId={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    await type('gam')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('excludeId=a&excludeId=c')
    expect(url).not.toContain('excludeId=b')
    expect(url).not.toContain('categoryId')
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.queryByText('Same cat')).not.toBeInTheDocument()
  })

  it('swaps the chosen product into the same slot in the compare URL', async () => {
    fetchMock.mockResolvedValue({ json: async () => [result()] })
    render(<CompareChangeButton productId="b" currentIds={['a', 'b', 'c']} categoryId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    await type('gam')
    fireEvent.mouseDown(screen.getByText('Gamma'))
    expect(push).toHaveBeenCalledWith('/compare?ids=a,p9,c')
    expect(screen.queryByPlaceholderText('Search product…')).not.toBeInTheDocument()
  })

  it('shows "No products found." for an empty result and ignores short queries', async () => {
    fetchMock.mockResolvedValue({ json: async () => [] })
    render(<CompareChangeButton productId="b" currentIds={['b']} categoryId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    await type('x')
    expect(fetchMock).not.toHaveBeenCalled()
    await type('xyz')
    expect(screen.getByText('No products found.')).toBeInTheDocument()
  })

  it('falls back to an empty result list when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    render(<CompareChangeButton productId="b" currentIds={['b']} categoryId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    await type('xyz')
    expect(screen.getByText('No products found.')).toBeInTheDocument()
  })
})

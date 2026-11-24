import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
let list: any[] = []
const removeFromCompare = vi.fn()
const clearCompare = vi.fn()
vi.mock('@/contexts/CompareContext', () => ({ useCompare: () => ({ compareList: list, removeFromCompare, clearCompare }) }))
vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: () => null }))

import CompareBar from '@/components/visitor/CompareBar'

const p = (id: string, image: string | null = null) => ({ id, name: `Product ${id}`, image })

describe('CompareBar', () => {
  beforeEach(() => {
    list = []
    push.mockReset()
    removeFromCompare.mockReset()
    clearCompare.mockReset()
  })

  it('stays hidden until two products are picked', () => {
    list = [p('a')]
    const { container } = render(<CompareBar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the picked products, the count and the actions', () => {
    list = [p('a', '/a.png'), p('b')]
    const { container } = render(<CompareBar />)
    expect(container.querySelector('[data-bottom-bar="compare"]')).not.toBeNull()
    expect(screen.getByAltText('Product a')).toHaveAttribute('src', '/a.png')
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Product b' })).toBeInTheDocument()
  })

  it('removes one product, clears all, and opens the comparison with every id', () => {
    list = [p('a'), p('b'), p('c')]
    render(<CompareBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Product b' }))
    expect(removeFromCompare).toHaveBeenCalledWith('b')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(clearCompare).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Compare Now' }))
    expect(push).toHaveBeenCalledWith('/compare?ids=a,b,c')
  })

  it('shows an empty slot until four are picked', () => {
    list = [p('a'), p('b')]
    const a = render(<CompareBar />)
    expect(a.container.querySelector('.border-dashed')).not.toBeNull()
    a.unmount()
    list = [p('a'), p('b'), p('c'), p('d')]
    const b = render(<CompareBar />)
    expect(b.container.querySelector('.border-dashed')).toBeNull()
  })
})

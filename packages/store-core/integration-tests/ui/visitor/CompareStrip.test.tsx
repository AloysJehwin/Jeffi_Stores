import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
let list: any[] = []
const removeFromCompare = vi.fn()
const clearCompare = vi.fn()
vi.mock('@/contexts/CompareContext', () => ({ useCompare: () => ({ compareList: list, removeFromCompare, clearCompare }) }))

import CompareStrip from '@/components/visitor/CompareStrip'

describe('CompareStrip', () => {
  beforeEach(() => {
    list = []
  })

  it('renders nothing for an empty compare list', () => {
    const { container } = render(<CompareStrip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('with one product: shows it, the count, and a disabled Compare button', () => {
    list = [{ id: 'a', name: 'Alpha', image: '/a.png' }]
    render(<CompareStrip />)
    expect(screen.getByAltText('Alpha')).toHaveAttribute('src', '/a.png')
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled()
  })

  it('removes a product and clears the list', () => {
    list = [{ id: 'a', name: 'Alpha', image: null }, { id: 'b', name: 'Beta', image: '/b.png' }]
    render(<CompareStrip />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha' }))
    expect(removeFromCompare).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(clearCompare).toHaveBeenCalled()
  })

  it('navigates to the compare page with the ids once two are picked', () => {
    list = [{ id: 'a', name: 'Alpha', image: null }, { id: 'b', name: 'Beta', image: null }]
    render(<CompareStrip />)
    const btn = screen.getByRole('button', { name: 'Compare (2)' })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(push).toHaveBeenCalledWith('/compare?ids=a,b')
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { CompareArea } from '@/components/admin/dashboard/CompareArea'

const points = [
  { label: '1 Dec', current: 100, previous: 80 },
  { label: '2 Dec', current: 150, previous: 200 },
  { label: '3 Dec', current: 120, previous: 0 },
]

describe('CompareArea', () => {
  it('draws the current line and the dashed previous line', () => {
    const { container } = render(<CompareArea points={points} />)
    expect(container.querySelector('[data-line="current"]')).toBeInTheDocument()
    expect(container.querySelector('[data-line="previous"]')!.getAttribute('stroke-dasharray')).toBe('4 4')
    expect(screen.getByText('1 Dec')).toBeInTheDocument()
    expect(screen.getByText('3 Dec')).toBeInTheDocument()
  })

  it('shows the hover card with both values and the change', () => {
    const { container } = render(<CompareArea points={points} format={n => `₹${n}`} />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.pointerEnter(container.querySelector('[data-zone="1"]')!)
    const tip = screen.getByRole('tooltip')
    expect(within(tip).getByText('2 Dec')).toBeInTheDocument()
    expect(within(tip).getByText('₹150')).toBeInTheDocument()
    expect(within(tip).getByText('₹200')).toBeInTheDocument()
    expect(within(tip).getByText('-25.0%')).toBeInTheDocument()
    expect(container.querySelector('[data-guide]')).toBeInTheDocument()
  })

  it('shows a dash when the previous value is zero', () => {
    const { container } = render(<CompareArea points={points} />)
    fireEvent.pointerEnter(container.querySelector('[data-zone="2"]')!)
    expect(within(screen.getByRole('tooltip')).getByText('–')).toBeInTheDocument()
  })

  it('arrow keys inspect points and Escape clears', () => {
    render(<CompareArea points={points} currentLabel="Now" />)
    const group = screen.getByRole('group')
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(within(screen.getByRole('tooltip')).getByText('1 Dec')).toBeInTheDocument()
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(within(screen.getByRole('tooltip')).getByText('2 Dec')).toBeInTheDocument()
    fireEvent.keyDown(group, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders an empty state without data', () => {
    render(<CompareArea points={[{ label: 'a', current: 0, previous: 0 }]} />)
    expect(screen.getByText('No data in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })
})

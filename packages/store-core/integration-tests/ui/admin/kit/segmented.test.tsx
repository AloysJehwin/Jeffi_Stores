import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SegmentedControl } from '@/components/admin/kit/segmented'

const options = [
  { value: '3d', label: '3D' },
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
]

describe('SegmentedControl', () => {
  it('is a labelled group of toggle buttons with the active one pressed and filled', () => {
    render(<SegmentedControl ariaLabel="Chart view" options={options} value="grid" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Chart view' })).toHaveClass('border', 'rounded-lg')
    const grid = screen.getByRole('button', { name: 'Grid' })
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(grid).toHaveClass('bg-accent-500', 'text-white')
    expect(screen.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '3D' })).toHaveClass('text-foreground-muted')
  })

  it('leaves every button unpressed when the value is null', () => {
    render(<SegmentedControl options={options} value={null} onChange={() => {}} />)
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the clicked value', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={options} value="3d" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(onChange).toHaveBeenCalledWith('list')
  })

  it('arrow keys, Home and End move focus without selecting', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={options} value="3d" onChange={onChange} />)
    const [a, b, c] = screen.getAllByRole('button')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(b).toHaveFocus()
    fireEvent.keyDown(b, { key: 'End' })
    expect(c).toHaveFocus()
    fireEvent.keyDown(c, { key: 'ArrowRight' })
    expect(a).toHaveFocus()
    fireEvent.keyDown(a, { key: 'ArrowLeft' })
    expect(c).toHaveFocus()
    fireEvent.keyDown(c, { key: 'Home' })
    expect(a).toHaveFocus()
    fireEvent.keyDown(a, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

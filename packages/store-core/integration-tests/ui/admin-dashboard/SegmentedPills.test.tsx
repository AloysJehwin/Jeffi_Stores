import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SegmentedPills } from '@/components/admin/dashboard/SegmentedPills'

const options = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
]

describe('SegmentedPills', () => {
  it('marks the selected option and gives only it a tab stop', () => {
    render(<SegmentedPills ariaLabel="Range" options={options} value="30d" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '30d' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '30d' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: '7d' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: '7d' })).toHaveAttribute('tabindex', '-1')
  })

  it('calls onChange on click', () => {
    const onChange = vi.fn()
    render(<SegmentedPills ariaLabel="Range" options={options} value="7d" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: '90d' }))
    expect(onChange).toHaveBeenCalledWith('90d')
  })

  it('arrow keys select the next and previous option, wrapping, and move focus', () => {
    const onChange = vi.fn()
    render(<SegmentedPills ariaLabel="Range" options={options} value="90d" onChange={onChange} />)
    const last = screen.getByRole('radio', { name: '90d' })
    last.focus()
    fireEvent.keyDown(last, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('7d')
    expect(screen.getByRole('radio', { name: '7d' })).toHaveFocus()
    fireEvent.keyDown(last, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('30d')
    fireEvent.keyDown(last, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('7d')
    fireEvent.keyDown(last, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('90d')
  })

  it('ignores other keys', () => {
    const onChange = vi.fn()
    render(<SegmentedPills ariaLabel="Range" options={options} value="7d" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: '7d' }), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

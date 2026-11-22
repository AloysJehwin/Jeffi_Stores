import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AutoGrowTextarea from '@/components/ui/AutoGrowTextarea'

describe('AutoGrowTextarea (render + change)', () => {
  it('renders a textarea with the controlled value', () => {
    render(<AutoGrowTextarea value="hello" onChange={() => {}} aria-label="notes" />)
    const ta = screen.getByLabelText('notes') as HTMLTextAreaElement
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta.value).toBe('hello')
  })

  it('forwards onChange when text is entered', () => {
    const onChange = vi.fn()
    render(<AutoGrowTextarea value="" onChange={onChange} aria-label="notes" />)
    fireEvent.change(screen.getByLabelText('notes'), { target: { value: 'typed' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reflects an updated controlled value on re-render', () => {
    const { rerender } = render(<AutoGrowTextarea value="one" onChange={() => {}} aria-label="notes" />)
    expect((screen.getByLabelText('notes') as HTMLTextAreaElement).value).toBe('one')
    rerender(<AutoGrowTextarea value="two" onChange={() => {}} aria-label="notes" />)
    expect((screen.getByLabelText('notes') as HTMLTextAreaElement).value).toBe('two')
  })

  it('applies minRows to the rows attribute', () => {
    render(<AutoGrowTextarea value="" onChange={() => {}} minRows={3} aria-label="notes" />)
    expect(screen.getByLabelText('notes')).toHaveAttribute('rows', '3')
  })

  it('passes through arbitrary textarea props (placeholder)', () => {
    render(<AutoGrowTextarea value="" onChange={() => {}} placeholder="Write..." />)
    expect(screen.getByPlaceholderText('Write...')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Toggle from '@/components/ui/Toggle'

describe('Toggle (render + interaction)', () => {
  it('renders a switch reflecting checked state and optional label', () => {
    render(<Toggle checked={true} onChange={() => {}} label="Notifications" />)
    const sw = screen.getByRole('switch')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })

  it('renders no label when none given', () => {
    render(<Toggle checked={false} onChange={() => {}} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('emits the toggled value on click', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} disabled />)
    const sw = screen.getByRole('switch')
    expect(sw).toBeDisabled()
    fireEvent.click(sw)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies the id to the control', () => {
    render(<Toggle checked={true} onChange={() => {}} id="wa-gate" />)
    expect(screen.getByRole('switch')).toHaveAttribute('id', 'wa-gate')
  })
})
